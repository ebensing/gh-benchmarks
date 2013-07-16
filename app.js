
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var mkdirp = require('mkdirp');

var http = require('http');
var https = require('https');
var qs = require('querystring');
var fs = require('fs');
var utils = require('util');
var exec = require('child_process').exec;
var path = require('path');

var config = require('./config/server.js');
var models = require('./models.js');
var git = require('./git.js');

// for debugging
mongoose.set('debug', true);

// the module that will do the graphing
// this is where you change it if you want to use your own
var grapher = require('gh-benchmarks-grapher');

mongoose.connect(config.mongoDBuri, function () {
  var JobDesc = mongoose.model('JobDesc', models.JobDesc);
  var Run = mongoose.model('Run', models.Run);
  var TaskRun = mongoose.model('TaskRun', models.TaskRun);

  var fileJobs = JSON.parse(fs.readFileSync("./config/jobs.json"));

  async.each(fileJobs.jobs, function (job, cb) {
    JobDesc.findOne({ title : job.title }, function (err, jdb) {
      if (err) return cb(err);

      // if the job already exists in the db, save any updated values
      if (jdb) {
        var keys = Object.keys(job);
        for (var i=0; i < keys.length; i++) {
          var k = keys[i];
          jdb[k] = job[k];
        }
        jdb.save(cb);
      } else {
        // else create it
        JobDesc.create(job, cb);
      }
    });
  }, function (err) {
    if (err) throw err;

    // this is the queue that will actually process all of the benchmarks
    var runQ = async.queue(function (run, queueCallback) {
      run.populate('job', function (err) {
        if (err) {
          console.log(err);
          return queueCallback(err);
        }
        async.waterfall([
          function (callback) {
            // clone the repo
            git.clone(run.job.cloneUrl, callback);

          }, function (repo_loc, callback) {
            // handle the preserved files - these are files from a different
            // branch that you want available in your main branch. useful for
            // running benchmarks on old tags, ect

            // copy all the necessary files
            // checkout the correct branch for each file & exec command
            async.eachSeries(run.job.preservedFiles, function (item, pcb) {
              var dir = utils.format("repos/.tmp/%s", path.dirname(item.name));
              mkdirp(dir, function(err) {
                if (err) return pcb(err);
                var command = utils.format("cp %s/%s repos/.tmp", repo_loc, item.name);
                git.checkout_ref(repo_loc, item.branch, function (err) {
                  if (err) return pcb(err);
                  exec(command, pcb);
                });
              });
            }, function (err) {
              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {

            // switch to the correct ref
            git.checkout_ref(repo_loc, run.job.cVal, function (err) {
              callback(err, repo_loc);
            });

          }, function (repo_loc, callback) {
            // copy in all of the preservedFiles

            async.each(run.job.preservedFiles, function (item, pcb) {
              var dir = utils.format("%s/%s", repo_loc, path.dirname(item.name));

              mkdirp(dir, function (err) {
                if (err) return pcb(err);

                var command = utils.format("cp repos/.tmp/%s %s/%s", item.name, repo_loc, item.name);
                exec(command, pcb);
              });
            }, function (err) {
              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {

            // run the setup work
            var before = run.job.before.map(function (item) {
              return utils.format("cd %s && ", repo_loc) + item;
            });
            async.eachSeries(before, function (command, cb) {
              exec(command, cb);
            }, function (err) {
              callback(err, repo_loc);
            });

          }, function (repo_loc, callback) {

            var allSucceed = true;
            // time to run the actual benchmarks
            async.eachSeries(run.job.tasks, function (task, cb) {
              var command = utils.format("cd %s && ", repo_loc) + task.command;
              exec(command, function (err, stdout, stderr) {
                var tr = new TaskRun({
                  title : task.title,
                  ts : new Date(),
                  run : run.id,
                  job: run.job.id
                });

                if (err) {
                  tr.status = "error";
                  tr.rawOut = err.toString();
                  allSucceed = false;
                  return tr.save(cb);
                }

                tr.status = "success";
                tr.rawOut = stdout.toString();
                // parse the returned data and save it
                tr.data = JSON.parse(stdout.toString());

                tr.save(cb);
              });
            }, function (err) {
              if (err || !allSucceed) {
                return callback(err || new Error("One or more Tasks failed."));
              }

              run.finished = new Date();
              run.status = "success";
              run.save(function (err) {
                callback(err, repo_loc);
              });
            });
          }, function (repo_loc, callback) {
            // run and post processing steps on the data
            TaskRun.find({ run : run.id }, function (err, taskRuns) {
              var allData = {};
              for (var i=0; i < taskRuns.length; i++) {
                var tr = taskRuns[i];
                allData[tr.title] = tr.data;
              }
              async.eachSeries(run.job.after, function (item, acb) {
                var arg = JSON.stringify(allData);
                var command = utils.format("cd %s && %s '%s'", repo_loc, item, arg);
                exec(command, function (err, stdout, stderr) {
                  if (err) return acb(err);
                  allData = JSON.parse(stdout.toString());
                  acb();
                });
              }, function (err) {
                if (err) return callback(err);

                run.output = allData;
                run.save(function (err) {
                  callback(err, repo_loc);
                });
              });
            });
          }, function (repo_loc, callback) {
            // need to remove the preserved files so that we can switch branches
            var files = run.job.preservedFiles.map(function (item) {
              return utils.format("%s/%s", repo_loc, item.name);
            });

            async.each(files, fs.unlink, function (err) {
              callback(err, repo_loc);
            });

          }, function (repo_loc, callback) {
            // switch to the branch where we will save results
            git.checkout_ref(repo_loc, run.job.saveBranch, function (err) {
              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {
            // get all of the data, the pass it into the grapher
            var cond = { job : run.job.id, status : "success" };
            var opts = { sort : '-ts' };
            Run.find(cond, {}, opts, function (err, runs) {
              if (err) return callback(err);
              // callback signature is (err, repo_loc, files) where files is an
              // array of all the files that have been changed/added
              grapher.buildGraphs(runs, run.job, repo_loc, callback);
            });
          }, function (repo_loc, files, callback) {
            // stage the files for commit
            git.add_files(repo_loc, files, function (err) {
              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {
            // commit the files

            var msg = utils.format("Benchmarks run and new results generated for %s", run.lastCommit);
            git.commit_repo(repo_loc, msg, function (err) {
              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {
            // push the files back to Github

            git.push_repo(repo_loc, "origin", run.job.saveBranch, function (err) {
              callback(err, repo_loc);
            });
          }
        ], function (err, repo_loc) {
          if (err) {
            console.log(err);
            run.status = "error";
            run.error = err;
            run.finished = new Date();
            // save it and go to cleanup
            return run.save(function (err) {
              cleanup(err, repo_loc, queueCallback);
            });
          }

          // no error, go to cleanup
          cleanup(null, repo_loc, queueCallback);
        });
      });
    }, 1);

    // check for the tags and make sure they've all been run
    JobDesc.find({ ref : /\/tags\// }, function (err, jobs) {
      if (err) return console.log(err);
      Run.find({ $or : [ { status : "success"}, { status : "error" }]}).distinct('job', function (err, ids) {
        if (err) return console.log(err);

        var l = jobs.length;
        for (var i=0; i < l; i++) {
          var job = jobs[i];

          if (ids.indexOf(job.id) == -1) {
            var run = new Run({
              ts : new Date(),
              job : job.id,
              status : 'pending',
            });

            // time to get the head commit
            var repo = job.repoUrl.replace("https://github.com/","");
            if (repo[repo.length -1] == "/") repo = repo.substr(0, repo.length - 1);
            var options = {
              host : "api.github.com",
              path : utils.format("/repos/%s/git/%s", repo, job.ref),
              method : "GET"
            };

            var req = https.request(options, function (res) {
              var data = "";
              res.on('data', function (d) {
                data += d.toString();
              });

              res.on('end', function () {
                var obj = JSON.parse(data);
                // if it has a message property, then no such ref exists
                if (obj.message) {
                  run.error = new Error("ref does not exist");
                  run.status = "error";
                  run.finished = new Date();
                  return run.save(function (err) {
                    if (err) return console.log(err);
                  });
                }

                run.lastCommit = obj.object.sha;
                run.save(function (err) {
                  if (err) return console.log(err);
                  runQ.push(run);
                });
              });
            });
            req.end();
          }
        }
      });
    });

    // start the listening server
    http.createServer(function (req, res) {
      // make sure things are coming from GitHub.. although these can be spoofed by
      // somebody if they really wanted to
      if (req.headers['user-agent'].indexOf("GitHub Hookshot") == -1 ||
          !req.headers['x-github-delivery'] || !req.headers['x-github-event']
          || req.method != 'POST') {
        console.log(req.headers);
        res.write("Only Accept requests from Github\n");
        res.statysCode = 505;
        return res.end();
      }
      var reqData = '';
      req.on('data', function (data) {
        // get all of the incoming data
        reqData += data.toString();
      });
      req.on('end', function () {
        // turn the data into an actual object that we can work with
        var reqJson = JSON.parse(qs.parse(reqData).payload);
        JobDesc.findOne({ repoUrl : reqJson.repository.url, ref : reqJson.ref }, function (err, jd) {
          if (err) {
            console.log(err);
            return;
          }
          // if we can't find a matching job, do nothing
          if (!jd) return;

          var run = new Run({
            ts : new Date(),
            job : jd.id,
            status : 'pending',
            lastCommit : reqJson.head_commit.id
          });

          // save the new task and put it on the queue
          run.save(function (err) {
            runQ.push(run);
          });
        });

        res.writeHead(200, "OK", {'Content-Type': 'text/html'});
        res.end();
      });
    }).listen(config.port, function () {
      console.log("Now listening on port %d", config.port);
    });
  });
});

function cleanup(err, repo_loc, callback) {
  var command = utils.format("rm -rf %s repos/.tmp", repo_loc);

  exec(command, function (err) {
    if (err) console.log(err);
    console.log("done");

    // this is the callback on the queue
    callback();
  });
}
