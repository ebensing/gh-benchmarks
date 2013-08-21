
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var mkdirp = require('mkdirp');
var email = require('nodemailer');
var GithubApi = require('github');

var http = require('http');
var https = require('https');
var qs = require('querystring');
var fs = require('fs');
var utils = require('util');
var exec_command = require('child_process').exec;
var spawn = require('child_process').exec;
var path = require('path');
var os = require('os');
var url = require('url');

// this is mainly used for the dockerization of the app
if (process.env.GH_WD) {
  process.chdir(process.env.GH_WD);
}

var github = new GithubApi({
  version : "3.0.0"
});

var config;
if (process.env.GH_DEV) {
 config = require('./test/server.js');
} else {
 config = require('./config/server.js');
}
var models = require('./models.js');
var git = require('./git.js');
var gauss = require('gauss');

// include the command that fails on the error message... Why isn't this
// default behavior?
function exec(command, callback) {
  exec_command(command, function (err, stdout, stderr) {
    if (err) {
      err.command = command;
      err.message += " Command: " + command;
    }
    return callback(err, stdout, stderr);
  });
}

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

var smtpTransport = email.createTransport("SMTP", {
  host : "localhost",
  port : 25
});

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
          var repo = jobM.repoUrl.replace(config.githubUri, "").split("/");
          var msg = {
            user : repo[0],
            repo : repo[1]
          };
          github.repos.get(msg, function (err, repo) {
            if (err) {
              return cb(err);
            }

            jobM.cloneUrl = repo.ssh_url;
            jobM.save(cb);
          });
        });
      }

      if (job.watchPullRequests) {
        // don't bother running these if we don't have github credentials to post with
        if (!process.env.githubUsername || !process.env.githubPassword) {
          console.log("No Github credentials provided, cannot create web hook");
          return mainCB();
        }
        // setup auth now
        github.authenticate({
          type: "basic",
          username : process.env.githubUsername,
          password : process.env.githubPassword
        });

        // setup the webhook for PRs now
        var repo = job.repoUrl.replace(config.githubUri, "").split("/");
        var msg = {
          user : repo[0],
          repo : repo[1],
          name : "web",
          events : ["pull_request"],
          config : {
            url : config.local_url + ":" + config.port,
            content_type : 'json'
          }
        };
        github.repos.createHook(msg, function (err, hook) {
          if (err) {
            if (err.message) {
              try {
                err = JSON.parse(err.message);
              } catch (e) {

              }
            }
            if (err.errors && err.errors.length &&
                err.errors[0].message != "Hook already exists on this repository") {
              console.log(err);
            }
            return;
          }
          console.log("Pull request hook for %s has been created", job.title);
        });
      }
    });
  }, function (err) {
    if (err) throw err;

    // this is the queue that will actually process all of the benchmarks
    var runQ = async.queue(function (run, queueCallback) {
      // if PR is set, this is actually a pull request, DO NOT USE THIS
      // WORKFLOW. The only reason we're even putting it on this queue is to
      // avoid having two things running simultaneously. Should probably
      // refactor this and make the commit run workflow more modular
      if (run.PR) {
        return cloneAndRunPullRequest(run, run.job, queueCallback);
      }
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
            // collect information about host system
            run.sysinfo.platform = os.platform();
            run.sysinfo.arch = os.arch();
            run.sysinfo.release = os.release();
            run.sysinfo.mem = os.totalmem();
            run.sysinfo.cpuCount = os.cpus().length;
            run.sysinfo.cpuVersion = os.cpus()[0].model;
            // don't bother saving these values to the DB yet. By the end of
            // this the db will write back and these can piggyback along with
            // that update
            callback(null, repo_loc);
          }, function (repo_loc, callback) {
            // handle the preserved files - these are files from a different
            // branch that you want available in your main branch. useful for
            // running benchmarks on old tags, ect

            // first, check if we even need to worry about them. This config
            // option was added when the new tag system was introduced. You
            // might only want the preserved files on the tag and not on the
            // branch that you are watching

            var searchName = run.tagName || run.job.ref;

            if (run.job.perservedFiles && run.job.perservedFiles.refs.indexOf(searchName) == -1) {
              return callback(null, repo_loc);
            }

            // copy all the necessary files
            // checkout the correct branch for each file & exec command
            async.eachSeries(run.job.preservedFiles.files, function (item, pcb) {
              var dir = utils.format("repos/.tmp/%s", path.dirname(item.name));
              mkdirp(dir, function(err) {
                if (err) return pcb(err);
                var command = utils.format("cp %s/%s repos/.tmp/%s", repo_loc,
                  item.name, item.name);
                git.checkout_ref(repo_loc, item.branch, function (err) {
                  if (err) return pcb(err);
                  exec(command, pcb);
                });
              });
            }, function (err) {
              callback(err, repo_loc);
            });
          }, function (repo_loc, callback) {

            // switch to the correct commit
            git.checkout_commit(repo_loc, run.lastCommit, function (err) {
              callback(err, repo_loc);
            });

          }, function (repo_loc, callback) {
            // check if we need to do this step
            var searchName = run.tagName || run.job.ref;

            if (run.job.perservedFiles && run.job.perservedFiles.refs.indexOf(searchName) == -1) {
              return callback(null, repo_loc);
            }

            // copy in all of the preservedFiles

            async.each(run.job.preservedFiles.files, function (item, pcb) {
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
                try {
                  // parse the returned data and save it
                  tr.data = JSON.parse(stdout.toString());
                } catch(err) {
                  tr.rawOut += err.toString();
                  tr.status = "error";
                  allSucceed = false;
                }

                tr.save(cb);
              });
            }, function (err) {
              if (err || !allSucceed) {
                return callback(err || new Error("One or more Tasks failed."), repo_loc);
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
                run.output = allData;
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
                var outObj;
                try {
                  outObj = JSON.parse(output);
                } catch(err) {
                  return callback(err);
                }

                run.output = outObj;
                run.save(function (err) {
                  callback(err, repo_loc);
                });
              });

              // write in the data
              proc.stdin.write(JSON.stringify(allData));
            });
          }, function (repo_loc, callback) {

            // check if we need to actually run this first

            var searchName = run.tagName || run.job.ref;

            if (run.job.perservedFiles && run.job.perservedFiles.refs.indexOf(searchName) == -1) {
              return callback(null, repo_loc);
            }

            // need to remove the preserved files so that we can switch branches
            var files = run.job.preservedFiles.files.map(function (item) {
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
            // if we're on a tag, let's get the actual commit time stamp so
            // that we can keep ordering nice
            if (!run.tagName || run.tagName == '') {
              return callback(null, repo_loc);
            }

            // this will query for the date on the commit and save the run
            // before returning
            getCommitDate(run, run.job, function (err) {
              callback(err, repo_loc);
            });

          }, function (repo_loc, callback) {
            // get all of the data, the pass it into the grapher
            var cond = { job : run.job.id, output : { $exists : true } };
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
                  processStdDevEmail(run.job, alrt, acb);
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
        console.log("Watching for build status for %s", run.job.title);
        if (err) {
          run.error = err;
          run.status = "error";
          return run.save(cb);
        }

        var repo = run.job.repoUrl.replace(config.githubUri,"");
        if (repo[repo.length -1] == "/") repo = repo.substr(0, repo.length - 1);
        repo = repo.split("/");
        var msg = {
          user : repo[0],
          repo : repo[1],
          sha : run.lastCommit
        };
        var intId = setInterval(function() {
          github.statuses.get(msg, function (err, statuses) {
            if (err) {
              return cb(err);
            }

            var l = statuses.length;
            for (var i=0; i < l; i++) {
              var r = statuses[i];
              if (r.state == 'success') {
                // it passed, push it on the queue to get run
                runQ.push(run);
                clearInterval(intId);
                return cb();
              }
              if (r.state == 'failure') {
                run.status = "error";
                run.error = new Error("Travis CI build failed");
                run.finished = new Date();
                run.save(function (err) {
                  clearInterval(intId);
                  return cb();
                });
              }
            }
          });
        }, 30 * 1000);
      });
    }, 3);

    // check for the tags and make sure they've all been run
    JobDesc.find({ tags : { $exists : true } }, function (err, jobs) {
      if (err) return console.log(err);
      // get all of the runs for tags
      var conds = { $or : [ { status : "success"}, { status : "error" }],
                    tagName : { $exists : true }};
      Run.find(conds, function (err, tagRuns) {
        if (err) return console.log(err);

        // create a map of the jobs & tags so that we can easily find tags that
        // have not been run yet
        var tagMap = {};
        for (var i=0; i < tagRuns.length; i++) {
          var tr = tagRuns[i];
          if (tagMap[tr.job.toString()] === undefined) tagMap[tr.job.toString()] = {};

          tagMap[tr.job.toString()][tr.tagName] = 1;
        }
        var l = jobs.length;
        for (var i=0; i < l; i++) {
          // careful to wrap these in closures to make sure that the index
          // stays the same between callbacks
          (function(i) {
            var job = jobs[i];
            var tags = job.tags;

            for (var x=0; x < tags.length; x++) {
              (function(x) {
                var tag = tags[x];
                var id = job.id.toString();
                // queue the run if either no tag runs for this job have been
                // completed or if this particular tag has not been completed
                if (!tagMap[id] || tagMap[id][tag] === undefined) {
                  console.log("Tag: %s on Job: %s has not been run, adding to queue", tag, job.title);
                  var run = new Run({
                    ts : new Date(),
                    job : job.id,
                    status : 'pending',
                    tagName : tag
                  });

                  // time to get the head commit
                  var repo = job.repoUrl.replace(config.githubUri,"");
                  if (repo[repo.length -1] == "/") repo = repo.substr(0, repo.length - 1);
                  repo = repo.split("/");
                  var msg = {
                    user : repo[0],
                    repo : repo[1],
                    ref : "tags/" + run.tagName
                  };
                  github.gitdata.getReference(msg, function (err, tag) {
                    if (err) {
                      run.error = new Error("ref does not exist");
                      run.status = "error";
                      run.finished = new Date();
                      console.log(run.error);
                      return run.save(function (err) {
                        if (err) {
                          console.log(err);
                        }
                      });
                    }

                    run.lastCommit = tag.object.sha;
                    run.save(function (err) {
                      if (err) return console.log(err);
                      runQ.push(run);
                    });
                  });
                }
              })(x);
            }
          })(i);
        }
      });
    });

    // start the listening server
    http.createServer(function (req, res) {
      // make sure things are coming from GitHub.. although these can be spoofed by
      // somebody if they really wanted to
      if (( req.headers['user-agent'] &&
          req.headers['user-agent'].indexOf("GitHub Hookshot") == -1) ||
        !req.headers['x-github-delivery'] || !req.headers['x-github-event'] ||
        req.method != 'POST') {
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
        var reqJson;
        try {
          reqJson = JSON.parse(qs.parse(reqData).payload);
        } catch (err) {
          // if we get an error, this means it is in the JSON format. <3 APIs
          // that have different content formats... This could be fixed if I
          // created the push hook for the user or set the content type of the
          // pull request hook to be the legacy thing, but f*** it.
          reqJson = JSON.parse(reqData);
        }
        // turn the data into an actual object that we can work with
        // check if this is a pull request or push event
        if (!reqJson.action && !reqJson.pull_request) {
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
        } else {
          // handle pull requests
          if (reqJson.action != 'closed') {
            var cond = {
              repoUrl : reqJson.pull_request.base.repo.html_url,
              ref : reqJson.pull_request.base.ref
            };
            JobDesc.findOne(cond, function (err, jd) {
              if (err) {
                console.log(err);
                return;
              }
              // if we can't find a matching job, do nothing
              if (!jd) return;

              if (!jd.watchPullRequests) {
                // we're not supposed to watch these
                return;
              }

              reqJson.pull_request.PR = true;
              reqJson.pull_request.job = jd;
              runQ.push(reqJson.pull_request);
            });
          }
        }

        res.writeHead(200, "OK", {'Content-Type': 'text/html'});
        res.end();
      });
    }).listen(config.port, function () {
      console.log("Now listening on port %d", config.port);
    });
    // this will be used for any clean up commands that the user might want to
    // run
    http.createServer(function (req, res) {
      var query = url.parse(req.url, true).query;

      res.writeHead(200, { "Content-Type" : "text/plain" });

      if (query.command) {
        if (query.command == "runFailed") {
          var cond = { $or : [{ status : "pending"}, { status : "error" }] };
          Run.find(cond, function (err, runs) {
            if (err) {
              console.log(err);
              return res.end("Command Failed\n");
            }

            var ids = runs.map(function (item) {
              return item.id;
            });

            TaskRun.remove({ _id : { $in : ids } }, function (err) {
              if (err) {
                console.log(err);
                return res.end("Command Failed\n");
              }

              TaskRun.update({ _id : { $in : ids } }, { status : "pending" },
                { multi : true }, function (err) {
                if (err) {
                  console.log(err);
                  return res.end("Command Failed\n");
                }

                for (var i=0; i < runs.length; i++) {
                  runQ.push(runs[i]);
                }

                res.end("Command Succeeded\n");
              });
            });
          });
        } else if (query.command == 'runCommit') {

          if (!query.sha) {
            console.log(new Error("Expecting 'sha' parameter for this command"));
            return res.end("Command Failed: Missing Parameter 'sha'\n");
          }

          if (!query.jobTitle) {
            console.log(new Error("Expecting 'jobTitle' parameter for this command"));
            return res.end("Command Failed: Missing Parameter 'jobTitle'\n");
          }

          JobDesc.findOne({ title : query.jobTitle }, function (err, job) {
            if (err) {
              console.log(err);
              return res.end("Command Failed\n");
            }

            if (job == null) {
              console.log("Job: %s not found", query.jobTitle);
              return res.end("Job not found\n");
            }

            var run = new Run({
              ts : new Date(),
              job : job.id,
              status : 'pending',
              lastCommit : query.sha
            });

            getCommitDate(run, job, function (err) {
              if (err) {
                console.log(err);
                return res.end("Command Failed\n");
              }

              runQ.push(run);
              res.end("Command Succeeded\n");
            });
          });
        } else {
          res.end('Unrecognized Command\n');
        }
      } else {
        res.end('No Command Specified\n');
      }
    }).listen(8081, function () {
      console.log("Maintenance port listening on 8081");
    });
  });

  // this function does the processing on a standard deviation alert
  function processStdDevEmail(job, alrt, callback) {

    Run.find({ job : job.id, status : "success" }, {}, { sort : '-ts' }, function (err, runs) {
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
        bodyTemplate += "The results differed by at least a standard deviation: \n\n";
        bodyTemplate += "Mean: %d\nStandard Deviation: %d\n Result: %d\n\n";
        bodyTemplate += "Check the full results on Github";
        var body = utils.format(bodyTemplate, job.projectName, job.ref, mean, stdev, mrVal);

        smtpTransport.sendMail({
          from : emailConfig.from,
          to : emailConfig.to.join(","),
          subject : title,
          text : body
        }, callback);

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
  bodyTemplate += "Here is the meta data on the run: \n\n %s \n\n";
  bodyTemplate += "Check the results on Github";
  var body = utils.format(bodyTemplate, run.job.projectName, run.job.ref, run.toString());

  smtpTransport.sendMail({
    from : config.from,
    to : config.to.join(","),
    subject : title,
    text : body
  }, function (err) {
    if (err) console.log(err);
  });
}
/**
 * This function is used for getting the actual commit date for the commit in
 * question
 *
 */
function getCommitDate(run, job, callback) {
  var repo = job.repoUrl.replace(config.githubUri,"");
  if (repo[repo.length -1] == "/") repo = repo.substr(0, repo.length - 1);
  repo = repo.split("/");

  var msg = {
    user : repo[0],
    repo : repo[1],
    sha : run.lastCommit
  };

  github.repos.getCommit(msg, function (err, obj) {
    if (err) {
      return callback(err);
    }

    run.ts = obj.commit.author.date;

    run.save(callback);
  });
}

function cloneAndRunPullRequest(pull_request, job, mainCB) {

  // don't bother running these if we don't have github credentials to post with
  if (!process.env.githubUsername || !process.env.githubPassword) {
    return mainCB();
  }

  async.waterfall([
    function (callback) {
      git.clone_https(pull_request.head.repo.clone_url, callback);
    }, function (repo_loc, callback) {
      // switch to the correct commit
      git.checkout_commit(repo_loc, pull_request.head.sha, function (err) {
        callback(err, repo_loc);
      });
    }, function (repo_loc, callback) {

      var output = {};
      // time to run the actual benchmarks
      async.mapSeries(job.tasks, function (task, cb) {
        var command = utils.format("cd %s && export PULL_REQUEST=true && %s",
          repo_loc, task.command);
        exec(command, cb);
      }, function (err, output) {
        if (err) {
          return callback(err, repo_loc);
        }

        // build the string that gets posted to Github
        var postStr = utils.format("Benchmarks for %s:\n", pull_request.head.sha);
        for (var i=0; i < job.tasks.length; i++) {
          var task = job.tasks[i];
          postStr += "**" + task.title + "**\n";
          postStr += "```\n";
          postStr += output[i].toString();
          postStr += "```\n\n";
        }
        callback(err, repo_loc, postStr);
      });
    }, function (repo_loc, postStr, callback) {

      // create the comment on the pull request. We use the issues API here
      // because pull request comments refer specifically to the comments on
      // pull request files.

      // setup auth now
      github.authenticate({
        type: "basic",
        username : process.env.githubUsername,
        password : process.env.githubPassword
      });
      var msg = {
        user : pull_request.base.user.login,
        repo : pull_request.base.repo.name,
        number : pull_request.number,
        body : postStr
      };

      github.issues.createComment(msg, function (err, comment) {
        callback(err, repo_loc);
      });
    }, function (repo_loc, callback) {
      job.pull_requests.push(pull_request.number);
      job.save(function (err) {
        callback(err, repo_loc);
      });
    }
  ], function (err, repo_loc) {
    if (err) {
      console.log(err);
    }
    cleanup(err, repo_loc, mainCB);
  });
}
