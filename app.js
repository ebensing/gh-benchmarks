
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var http = require('http');

var config = require('./config/server.js')


http.createServer(function (req, res) {
  if (req.headers['user-agent'].indexOf("GitHub Hookshot") == -1 ||
      !req.headers['x-github-delivery'] || !req.headers['x-github-event']
      || req.method != 'POST') {
    console.log(req.headers);
    res.write("Only Accept requests from Github\n");
    res.statysCode = 505;
    return res.end();
  }
  console.log("hi");
  var reqData = '';
  req.on('data', function (data) {
    reqData += data.toString();
  });
  req.on('end', function () {
    console.log(reqData);
    res.writeHead(200, "OK", {'Content-Type': 'text/html'});
    res.end();
  });
}).listen(config.port);
