
// this will be the server that runs on your machine and does the actual
// benchmarks

var mongoose = require('mongoose');
var async = require('async');
var http = require('http');

var config = require('./config/server.js')


http.createServer(function (req, res) {
  console.log("Request Recieved");
  console.log(req);
  res.end();
}).listen(config.port);
