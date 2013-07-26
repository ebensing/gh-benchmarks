
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var mkdirp = require('mkdirp');
var email = require('email');

var http = require('http');
var https = require('https');
var qs = require('querystring');
var fs = require('fs');
var utils = require('util');
var exec = require('child_process').exec;
var spawn = require('child_process').exec;
var path = require('path');

var config;
if (process.env.GH_DEV) {
 config = require('./test/server.js');
} else {
 config = require('./config/server.js');
}
var models = require('./models.js');
var git = require('./git.js');
var gauss = require('gauss');

// for debugging
//mongoose.set('debug', true);

// helper function to get object property by string
Object.byString = function(o, s) {
  s = s.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
  s = s.replace(/^\./, '');           // strip a leading dot
  var a = s.split('.');
  while (a.length) {
      var n = a.shift();
      if (n in o) {
          o = o[n];
      } else {
          return;
      }
  }
  return o;
}

// the module that will do the graphing
// this is where you change it if you want to use your own
var grapher = require('gh-benchmarks-grapher');

mongoose.connect(config.mongoDBuri, function () {
  var JobDesc = mongoose.model('JobDesc', models.JobDesc);
  var Run = mongoose.model('Run', models.Run);
  var TaskRun = mongoose.model('TaskRun', models.TaskRun);

  var fileJobs = JSON.parse(fs.readFileSync(config.jobsFile));
  // import email config & set the from address
  var emailConfig = JSON.parse(fs.readFileSync(config.emailFile));
  email.from = emailConfig.from;

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
        JobDesc.create(job, function (err, jobM) {
          if (err) return cb(err);

          // if the user specified the cloneUrl don't check- we allow the user
          // to specify their own in case they have a private repo
          if (jobM.cloneUrl) {
            return cb();
          }

          // get the clone url
          var repo = jobM.repoUrl.replace(config.githubUri, "");
          var options = {
            host : config.githubApiUri,
            path : utils.format("/repos/%s", repo),
            method : "GET"
          };
          var req = https.request(options, function (res) {
            var content = "";

            res.on('data', function (data) {
              content += data.toString();
            });

            res.on('end', function () {
              var respObj = JSON.parse(content);
              jobM.cloneUrl = respObj.ssh_url;
              jobM.save(cb);
            });
          });
          req.end()
        });
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
        console.log("Running Job: %s", run.job.title);
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
            git.checkout_ref(repo_loc, run.job.ref, function (err) {
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

              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {
            // run and post processing steps on the data
            TaskRun.find({ run : run.id }, function (err, taskRuns) {
              var allData = {};
              for (var i=0; i < taskRuns.length; i++) {
                var tr = taskRuns[i];
                allData[tr.title] = tr.data;
              }

              // if after doesn't exist, save the output and move on
              if (!run.job.after) {
                run.ouput = allData;
                return run.save(function (err) {
                  callback(err, repo_loc);
                });
              }

              // split the command by spaces, need this to be able to spawn
              var comArr = run.job.after.split(' ');
              var command = comArr[0];
              var args = comArr.slice(1);

              // spawn the command
              var proc = spawn(command, args);

              // read the data coming back on stdout
              var output = "";
              proc.stdout.on('data', function (data) {
                output += data.toString();
              });

              // save the output
              proc.on('close', function (code) {
                var outObj = JSON.parse(output);

                run.output = outObj;
                run.save(function (err) {
                  callback(err, repo_loc);
                });
              });

              // write in the data
              proc.stdin.write(JSON.stringify(allData));
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
            var cond = { job : run.job.id };
            var opts = { sort : '-ts' };
            Run.find(cond, {}, opts, function (err, runs) {
              if (err) return callback(err);
              // callback signature is (err, files) where files is an
              // array of all the files that have been changed/added
              grapher.buildGraphs(runs, run.job, repo_loc, function(err, files) {
                callback(err, repo_loc, files);
              });
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
              // send the email to let people know it is done
              sendCompletionEmail(run, emailConfig);
              cleanup(err, repo_loc, queueCallback);
            });
          }

          run.finished = new Date();
          run.status = "success";
          run.save(function (err) {
            sendCompletionEmail(run, emailConfig);
            async.each(run.job.alerts, function (alrt, acb) {
              switch(alrt.type) {
                case "std-dev":
                  processStdDevEmail(run.job, acb);
                  break;
              }
            }, function (err) {
              if (err) console.log(err);
              // no error, go to cleanup
              cleanup(null, repo_loc, queueCallback);
            });
          });
        });
      });
    }, 1);

    // this is the queue that checks to see if a commit has passed on travis
    // yet
    var travisQ = async.queue(function (run, cb) {
      run.populate('job', function (err) {
        if (err) {
          run.error = err;
          run.status = "error";
          return run.save(cb);
        }

        var repo = run.job.repoUrl.replace(config.githubUri,"");
        if (repo[repo.length -1] == "/") repo = repo.substr(0, repo.length - 1);
        var options = {
          host : config.githubApiUri,
          path : utils.format("/repos/%s/statuses/%s", repo, run.lastCommit),
          method : "GET"
        };
        var intId = setInterval(function() {
          var req = https.request(options, function (res) {
            var data = "";

            res.on('data', function (d) {
              data += d.toString();
            });

            res.on('end', function () {
              var resp = JSON.parse(data);

              var l = resp.length;
              for (var i=0; i < l; i++) {
                var r = resp[i];
                if (r.state == 'success') {
                  // it passed, push it on the queue to get run
                  runQ.push(run);
                  clearInterval(intId);
                  cb();
                }
                if (r.state == 'failure') {
                  run.status = "error";
                  run.error = new Error("Travis CI build failed");
                  run.finished = new Date();
                  run.save(function (err) {
                    clearInterval(intId);
                    cb();
                  });
                }
              }
            });
          });
          req.end();
        }, 30 * 1000);
      });
    }, 3);

    // check for the tags and make sure they've all been run
    JobDesc.find({ isTag : true }, function (err, jobs) {
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
            var repo = job.repoUrl.replace(config.githubUri,"");
            if (repo[repo.length -1] == "/") repo = repo.substr(0, repo.length - 1);
            var options = {
              host : config.githubApiUri,
              path : utils.format("/repos/%s/git/refs/tags/%s", repo, job.ref),
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
        var cond = {
          repoUrl : reqJson.repository.url,
          // we only need to remove the branches because a push notification
          // will never be a tag
          ref : reqJson.ref.replace("refs/heads/","")
        };
        JobDesc.findOne(cond, function (err, jd) {
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
            travisQ.push(run);
          });
        });

        res.writeHead(200, "OK", {'Content-Type': 'text/html'});
        res.end();
      });
    }).listen(config.port, function () {
      console.log("Now listening on port %d", config.port);
    });
  });

  // this function does the processing on a standard deviation alert
  function processStdDevEmail(job, alrt, callback) {

    Run.find({ job : job.id }, {}, { sort : '-ts' }, function (err, runs) {
      if (err) {
        return callback(err);
      }

      // grab the most recent run
      var mostRecent = runs.shift();

      // if this is our very first run, don't worry about any of this
      if (runs.length == 0) {
        return callback();
      }
      var values = runs.map(function (item) {
        return Object.byString(item.output[alrt.taskTitle], alrt.field);
      });

      var set = new gauss.Vector(values);
      var stdev = set.stdev();
      var mean = set.mean();

      var mrVal = Object.byString(mostRecent.output[alrt.taskTitle], alrt.field);

      var diff = Math.abs(mean - mrVal);
      if (diff > stdev) {
        // send the email

        var title = utils.format("Benchmarks on %s have changed by at least a standard deviation", job.projectName);
        var bodyTemplate = "Your Benchmarks for %s on the %s ref have finished running.\n\n";
        body += "The results differed by at least a standard deviation: \n\n";
        body += "Mean: %d\nStandard Deviation: %d\n Result: %d\n\n";
        body += "Check the full results on Github";
        var body = utils.format(bodyTemplate, job.projectName, job.ref, mean, stdev, mrVal);
        var e = new email.Email({
          to : config.to,
          subject: title,
          body: body
        });

        e.send(callback);
      } else {
        // within a standard deviation, don't send an email
        callback();
      }
    });
  }
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

/**
 * Helper function for sending emails when benchmarks have finished
 *
 * @param {Object} run - this is the mongoose Run object for the benchmarks that just finished
 * @param {Object} config - this is the config information for the email
 */

function sendCompletionEmail(run, config) {

  var title = utils.format("Benchmarks on %s have finished", run.job.projectName);
  var bodyTemplate = "Your Benchmarks for %s on the %s ref have finished running.\n\n";
  body += "Here is the meta data on the run: \n\n %s \n\n";
  body += "Check the results on Github";
  var body = utils.format(bodyTemplate, run.job.projectName, run.job.ref, run.toString());
  var e = new email.Email({
    to : config.to,
    subject: title,
    body: body
  });

  e.send(function (err) {
    if (err) {
      console.log(err);
    }
  });
}

