
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobDesc = new Schema({
    title : String,
    repoUrl : String,
    ref : String,
    tasks: [{ title : String, command : String, fields : {}}],
    charts: [{ title : String, type : { type : String }, data : {}}]
});

var Run = new Schema({
    ts : Date,
    JobId : { type : Schema.Types.ObjectId, ref : 'JobDesc' },
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
