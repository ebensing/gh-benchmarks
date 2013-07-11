
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobDesc = new Schema({
    title : String,
    repoUrl : String,
    ref : String,
    tasks: [{ title : String, command : String, fields : {}}],
    charts: [{ title : String, type : { type : String }, data : {}}]
});

JobDesc.virtual('branch').get(function () {
  return this.ref.replace("refs/heads/","");
});

JobDesc.virtual('tag').get(function () {
  return this.ref.replace("refs/tags/","");
});

JobDesc.virtual('cVal').get(function () {
  return this.ref.indexOf("refs/tags/") == -1 ? this.branch : this.tag;
});

var Run = new Schema({
    ts : Date,
    job : { type : Schema.Types.ObjectId, ref : 'JobDesc' },
    status : String,
    lastCommit : String
});

var TaskRun = new Schema({
    ts : Date,
    RunId : { type : Schema.Types.ObjectId, ref : 'Run' },
    status : String,
    data : {},
    rawOut : String
});

exports.JobDesc = JobDesc;

exports.Run = Run;

exports.TaskRun = TaskRun;
