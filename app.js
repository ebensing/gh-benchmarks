
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var http = require('http');
var qs = require('querystring');
var fs = require('fs');

var config = require('./config/server.js');
var models = require('./models.js');

// for debugging
mongoose.set('debug', true);

mongoose.connect(config.mongoDBuri, function () {
  var JobDesc = mongoose.model('JobDesc', models.JobDesc);
  var Run = mongoose.model('Run', models.Run);
  var TaskRun = mongoose.model('TaskRun', models.TaskRun);

  var fileJobs = JSON.parse(fs.readFileSync("./config/jobs.json"));

  async.forEach(fileJobs.jobs, function (job, cb) {
    JobDesc.findOne({ title : job.title }, function (err, jdb) {
      if (err) return cb(err);

      // if the job already exists in the db, just move on
      if (jdb) {
        cb();
      } else {
        // else create it
        JobDesc.create(job, cb);
      }
    });
  }, function (err) {
    if (err) throw err;

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
          console.log(jd);
        });

        res.writeHead(200, "OK", {'Content-Type': 'text/html'});
        res.end();
      });
    }).listen(config.port, function () {
      console.log("Now listening on port %d", config.port);
    });
  });
});


