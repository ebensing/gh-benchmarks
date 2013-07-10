
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobDesc = new Schema({
    title : String,
    repoUrl : String,
    branchName : String,
    tasks: [{ title : String, command : String, fields : {}}],
    charts: [{ title : String, type : { type : String }, data : {}}]
});

var Run = new Schema({
    ts : Date,
    JobId : { Schema.Types.ObjectId, ref : 'JobDesc' },
    status : String,
    lastCommit : String
});

var TaskRun = new Schema({
    ts : Date,
    RunId : { Schema.Types.ObjectId, ref : 'Run' },
    status : String,
    data : {},
    rawOut : String
});

exports.JobDesc = JobDesc;

exports.Run = Run;

exports.TaskRun = TaskRun;
