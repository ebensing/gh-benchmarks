
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobDesc = new Schema({
    title : String,
    repoUrl : String,
    cloneUrl : String,
    ref : String,
    tasks: [{ title : String, command : String, fields : {}}],
    charts: [{ title : String, type : { type : String }, data : {}}],
    before: [String],
    saveBranch : { type : String, default : "gh-pages" },
    saveLoc : { type : String, default : "benchmarks" }
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
    lastCommit : String,
    finished : Date,
    error : {}
});

var TaskRun = new Schema({
    title : String,
    ts : Date,
    run : { type : Schema.Types.ObjectId, ref : 'Run' },
    job : { type : Schema.Types.ObjectId, ref : 'Job' },
    status : String,
    data : {},
    rawOut : String
});

exports.JobDesc = JobDesc;

exports.Run = Run;

exports.TaskRun = TaskRun;
