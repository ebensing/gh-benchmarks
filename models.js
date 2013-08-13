
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var JobDesc = new Schema({
    title : String,
    repoUrl : String,
    cloneUrl : String,
    ref : String,
    tags : [String],
    tasks: [{ title : String, command : String }],
    charts: [{
      title : String,
      type : { type : String },
      units : String,
      config : {}
    }],
    before: [String],
    after: String,
    saveBranch : { type : String, default : "gh-pages" },
    saveLoc : { type : String, default : "benchmarks" },
    projectName : String,
    preservedFiles : {
      refs : [String],
      files : [{ branch : String, name : String }]
    },
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
    output : {},
    tagName : String,
    sysinfo : {
      platform : String,
      arch : String,
      release : String,
      mem : Number,
      cpuCount : Number,
      cpuVersion : String
    }
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
