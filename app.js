
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var http = require('http');

var config = require('./config/server.js')


http.createServer(function (req, res) {
  if (req.headers['user-agent'].indexOf("Github Hookshot") == -1 ||
      !req.headers['x-github-delivery'] || !req.headers['x-github-event']
      || req.method != 'POST') {
    res.write("Only Accept requests from Github\n");
    res.statysCode = 505;
    return res.end();
  }
  req.on('data', function (data) {
    console.log(data);
  });
  req.on('end', function () {
    res.writeHead(200, "OK", {'Content-Type': 'text/html'});
    res.end();
  });
}).listen(config.port);
