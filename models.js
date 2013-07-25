
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobDesc = new Schema({
    title : String,
    repoUrl : String,
    cloneUrl : String,
    ref : String,
    isTag : Boolean,
    tasks: [{ title : String, command : String }],
    charts: [{ title : String, type : { type : String }, config : {}}],
    before: [String],
    after: String,
    saveBranch : { type : String, default : "gh-pages" },
    saveLoc : { type : String, default : "benchmarks" },
    projectName : String,
    preservedFiles : [{ branch : String, name : String }],
    alerts : [{ taskTitle : String,
              field : String,
              type : { type : String, enum : ["std-dev"] }}]
});

var Run = new Schema({
    ts : Date,
    job : { type : Schema.Types.ObjectId, ref : 'JobDesc' },
    status : String,
    lastCommit : String,
    finished : Date,
    error : {},
    output : {}
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
