
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var http = require('http');
var qs = require('querystring');
var fs = require('fs');
var utils = require('util');
var exec = require('child_process').exec;

var config = require('./config/server.js');
var models = require('./models.js');
var git = require('./git.js');

// for debugging
mongoose.set('debug', true);

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

            // switch to the correct ref
            git.checkout_ref(repo_loc, run.job.cVal, function (err) {
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
                tr.data = {};
                // parse the returned data and save it
                var outJson = JSON.parse(stdout.toString());
                var keys = Object.keys(task.fields);
                for (var i=0; i < keys.length; i++) {
                  var k = keys[i];
                  tr.data[k] = outJson[k];
                }
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
            // switch to the branch where we will save results
            git.checkout_ref(repo_loc, run.job.saveBranch, function (err) {
              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {
            // time to build the data for the charts

            var data = [];
            async.eachSeries(run.job.charts, function (chart, cb) {
              switch(chart.type) {
                case "singleBar":
                  var cond = { job : run.job.id, title : chart.data.taskTitle };
                  var opts = { populate : 'run', sort : '-ts' };
                  TaskRun.find(cond, {}, opts, function (err, taskruns) {
                    if (err) return cb(err);
                    var chartData = [];
                    for (var i=0; i < taskruns.length; i++) {
                      var tr = taskruns[i];
                      var o = {};
                      o.x = tr.run.lastCommit.substr(tr.run.lastCommit.length - 6);
                      o.y = tr.data[chart.data.field];
                      chartData.push(o);
                    }
                    data.push(chartData);
                    cb();
                  });
                  break;
                case "doubleBar":
                  break;
                case "line":
                  break;
              }
            }, function (err) {
              var writeObj = { data : data };
              var saveLoc = utils.format("%s/%s/data.json", repo_loc, run.job.saveLoc);
              fs.writeFileSync(saveLoc, JSON.stringify(writeObj));
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
  console.log("done");
  callback();
}
