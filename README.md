
Github Benchmarks
=====================

This project enables you to easily setup benchmarks for any Github repo. 
Basically, TravisCI but for benchmarks.

Overview
====================

gh-benchmarks it is meant to be language agnostic- if you set everything up
correctly, this should be able to do benchmarks for any piece of software.

Each instance of gh-benchmarks that is running (only recommend 1 per sever),
has a collection of jobs to run. These jobs describe different benchmarks that
should be run for your project. Each Job is made up of a collection of tasks,
these tasks are shell commands that should run your benchmarks (IE. `node
benchmarks.js` or `make benchmarks`).

Each task should output *JSON* data representing the information collected
during that benchmark run. It does not need to be in any specific format,
unless you are using one of the pre-made templates, in which case it should
conform to those standards.

Each job also has charts associated with it. These can be bar or line charts.
(by default, you are welcome to extend the functionality and create new charts!
See below for more information) They will be uploaded into a specified branch
of your Github repository along with the data. (By default, this all goes in
your gh-pages branch)

Workflow
------------------

1. After you push to your repository, a Github webhook is triggered.
2. gh-benchmark examines the request and sees if it matches any jobs in your
   jobs configuration
3. If it does, then it starts checking Github every 30 seconds to see if the
   status on the HEAD commit is "success" or "failure" (Generally, this is
   something Travis CI will upload once your project finishes all of its tests)
4. If the status is "success," then the system will queue up the benchmarks to
   be run. Note: Only a single benchmark runs at a time to make sure consistent
   results are collected
5. To run the benchmarks, the system clones a fresh copy of the repository,
   runs any "before" commands, and then executes all tasks sequentially.
6. After all of the tasks have completed, the system then runs an after command
   if one exists
7. Then, the system generates the charts specified in the config file.
8. Finally, these charts are then committed and pushed to Github (by default,
   in the gh-pages branch)

Installation
====================

Unlike Travis though, you need to host this yourself. It should run on any
linux machine if you follow the instructions below.

If you're on Ubuntu (or something with apt-get):

1. run `./installGHBench.sh` 

If you're not on Ubuntu:

You need to have the following things installed on your system:

1. [Node.js](http://nodejs.org/) (ver. > 10.0) (It should come with it, but
   make sure you get npm as well)
2. [MongoDB](http://docs.mongodb.org/manual/installation/)
3. [Postfix](http://www.postfix.org/)
4. [Git](https://help.github.com/articles/set-up-git#platform-all)
5. After all of these dependencies have been installed, run `npm install -d`
   from the root directory of the project

And that's it! All of the necessary dependencies should be installed. Now, you
just need to setup the config and webhook!

Webhook
--------------------
In order to setup a webhook for your repository, do the following from your
repository's home page

1. "Settings"
2. "Service Hooks"
3. "WebHook URLs"
4. Add mydomain.com:port as a URL. The default port is 8080, but check
   server.js to see what this value is for you.
5. (Optional) It is recommended that you make the port only available to the
   IPs listed below the "Update settings" button


Configuration
====================

All of the configuration for gh-benchmarks lives in the config/ directory in
two JSON files and on javascript file.

* `server.js` - what port the server should run on (defaults to 8080) and the
  uri for your mongoDB instance
* `email.json` - This contains the information about who to email once a
  benchmark has been run
* `jobs.json` - This contains the information about the different benchmarks
  you want run

server.js
--------------------

* *port* - The port for the server to run on. Defaults to 8080
* *mongoDBuri* - The uri of the mongoDB instance that the system should connect
  to. Defaults to localhost
* *githubUri* - Github URL. You can change this if you happen to be running
  your own instance of Github
* *githubApiUri* - Github API URL
* *jobsFile* - This is the JSON file which contains all of your job data, by
  default this is `config/jobs.json`
* *emailFile* - This is the JSON file which contains the email configuration
  information

email.json
--------------------

* *from* - {String} - This is the email address that the emails will have in
  the `from` field 
* *to* - {Array of Strings} - These are the email address that the
  notifications will be sent to

jobs.json
--------------------

* *jobs* - {Array of jobs} - This is the array of jobs that the server will
  run. The structure of a job is described below

Job
--------------------

Note: For this example, I am using a more javascript style syntax to make it
easier to read, but the actual jobs should be in properly formatted JSON. If
you don't know what this means, take a look at the examples

```javascript
{
  // This is the Job title. It is used as a unique identifier for the job
  title : "Mongoose: Master Branch",
  // This is the name of the project that this job relates to
  projectName : "Mongoose",
  // This is the URL of the Github repository
  repoUrl : "https://github.com/LearnBoost/mongoose",
  // This is the URL to clone your repository from (Only required if you
  // are using a private repository)
  cloneUrl : "git@github.com:LearnBoost/mongoose.git",
  // This is the branch or tag name that the job should watch for
  ref : "master",
  // tags to run these tests on
  tags : [ "3.6.15", "3.6.14" ],
  // These are the commands to run before the tasks run
  before : ["npm install -d"],
  // These are the benchmark tasks to run
  tasks : [
    // each task has a title, which servers as a unique identifier and a
    // command, which is the shell command to execute to run the benchmarks
    { title : "performance", command : "node benchmarks.js" }
  ],
  // This is the command to run after all tasks have been completed. 
  after : "node postProcessing.js",
  // These are the charts to generate.
  charts : [
    // For more information on the format for charts, see below.
  ],
  // The branch that the new data and charts should be committed to.
  // Defaults to gh-pages.
  saveBranch : "gh-pages",
  // The location in your repository where the benchmark data should be saved.
  saveLoc : "benchmarks/",
  // These are files you could like to have from other branches when you
  // run your benchmarks. These are particularly useful if you are trying to
  // run benchmarks on old tags that do not have the benchmark code in their
  // version of the repository. 
  // refs - these are the refs where the files should be preserved. These
  //        values can be any tag name or the name on the ref property
  // files - These are the actual files to preserve
  //
  // In this example, only the run on the 3.6.15 tag will have the files
  // preserved, all other runs will not have access to the files specified below
  preservedFiles : {
    refs : [ "3.6.15" ],
    files : [
      { "branch" : "benchmarks", "name" : "benchmarks/main.js" }
    ]
  }
}
```

Job Fields
====================

These are the fields on each job, and an in depth explanation for them.

title - String
--------------------
This is the title of the job. It should be unique from all other jobs running
on this server. It is only used as a unique identifier.

projectName - String
--------------------
This is the name of the project that the benchmarks are running for. This is
only used for chart templating.

repoUrl - String
--------------------
This is the https URL for your repository. *make sure it is an https address*

cloneUrl - String
--------------------
This is the ssh url for your repository. Only specify it if you are running
benchmarks on a private repository.

ref - String
--------------------
This is the ref name for what should be watched. The system will listen for
push webhooks from Github and run the benchmarks if it is for a branch that we
are interested in.

tags - Array of Strings
--------------------
These are the tags to run these commands on. The system will check to see if a
run has either failed or succeeded for each of these at startup. If one has
not, then it will run them.

before - Array of Strings
--------------------
This is an array of shell commands to run before any of the tasks are run.
These will be run from the root of your repo and any output from them is
discarded. 

tasks - Array of Tasks
--------------------
This is an array of task objects. Each task object has the following structure:

`{ title : "someBenchmark", "command" : "node someBenchmark.js" }`

Title is a unique identifier for the task, it will be used when specifying
charts or if you need to access the information generated by this test during
the after command. Command is a shell command to be run from the command line.
It will be run from the root directory of your repository and it should produce
JSON output on stdout to represent the data from that run.

after - String
--------------------
This is a single command to be run after all of the tasks have completed. It
will have the results of the tasks streamed to it on stdin in the following
format:

```javascript
{
  task1.title : { ... output ... },
  task2.title : { ... output ... },
  task3.title : { ... output ... }
}
```
Where the task1.title, ect. is replace by the title of the task. This command
should also produce JSON content on stdout, which will be saved as the output
for the run. This is the content that will be used when generating the charts.
IT IS HIGHLY RECOMMENDED THAT YOU KEEP IT IN THIS SAME FORMAT, IE. taskTitle :
content. The reasoning behind this is explained in the charts section

### Note

This uses node's
[`child_process.spawn`](http://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options)
method to run this command. Thus, the command is split along spaces and the
first item is treated as the program name, and the rest of the items are passed
in as arguments.

IE. `node someThing.js --flags` means `node` is run with `someThing.js` as
argument 1 and `--flags` as argument 2. Do not try and pipe stuff like `grep *
| node fail.js`, ect.

This is different from the `before` and `task` commands, which are all run
using
[`exec`](http://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback).

charts - Array of Charts
--------------------
By default, gh-benchmarks supports 3 kinds of graphs: line, single bar, and
multiple bar. The formats for each of these looks a little different, and it
easy to add your own chart renderer if you would like.

### Single Bar

Single bar graph track a single value across commits and create a vertical bar
for each commit/tag

```javascript
{ 
  title : "Single Bar Title",
  type : "singleBar",
  config : { taskTitle : "title of the task", field : "field of the output to graph" }
}
```

For example, if you have some task `{ title : "perf", command : "node perf.js"
}` and it produces the following JSON output when it finishes `{ time : X, ops
: 123456 }` Then in order to graph the `ops` value, you would have a chart like
this:

```javascript
{ 
  title : "Single Bar Title",
  type : "singleBar",
  config : { taskTitle : "perf", field : "ops" }
}
```

### Multiple Bar

This is a set of bars per commit/tag.

```javascript
{ 
  title : "Multi-Bar Title",
  type : "multiBar",
  config : { values : [
    { taskTitle : "title of the task", field : "field 1" },
    { taskTitle : "title of the task", field : "field 2" },
    { taskTitle : "title of the task", field : "field 3" },
    { taskTitle : "title of the task", field : "field 4" }
  ] }
}
```

For example, if you had two tasks `{ title : "insert", command : "node
insert.js" }` and `{ title : "update", command : "node update.js" }` and each
produced output that looked like `{ time : X, ops : 123456 }` then the graph
configuration would look like:

```javascript
{ 
  title : "Multi-Bar Title",
  type : "multiBar",
  config : { values : [
    { taskTitle : "insert", field : "ops" },
    { taskTitle : "update", field : "ops" }
  ] }
}
```

### Line Graph

This is 1 or more lines graphed with the x-axis being commits/tags.

```javascript
{ 
  title : "Line Title",
  type : "line",
  config : { lines : [
    { taskTitle : "title of the task", field : "field 1" },
    { taskTitle : "title of the task", field : "field 2" },
    { taskTitle : "title of the task", field : "field 3" },
    { taskTitle : "title of the task", field : "field 4" }
  ] }
}
```

For example, if you had two tasks `{ title : "insert", command : "node
insert.js" }` and `{ title : "update", command : "node update.js" }` and each
produced output that looked like `{ time : X, ops : 123456 }` then the graph
configuration would look like:

```javascript
{ 
  title : "Line Title",
  type : "line",
  config : { lines : [
    { taskTitle : "insert", field : "ops" },
    { taskTitle : "insert", field : "ops" }
  ] }
}
```

### How taskTitle and field are used

As mentioned in the output script, it is highly recommended to keep the output
in the same format. This is because the grapher essentially graphs its values
using code like this `Object.byString(run.output[taskTitle], field)`
`Object.byString` is a function that can get nested reference by using a
string. So, these are all valid field values : `"prop.anotherprop.thing"`,
`"prop[0].thing"`, and `"thing"`. Keep this in mind when doing post-processing
computation and modifying the output of your tasks.

saveBranch - String
--------------------
This is the branch that all of the content for the charts will be saved to. It
defaults to gh-pages because the intended purpose of this tool is to
automatically upload charts of benchmarks to github for display using Github
pages. 

saveLoc - String
--------------------
This is the location in the repository to save the generated files. This should
be a path relative to your repository root.

preservedFiles - Object
--------------------
This is an object that has a list of files to make available and the list of
refs for which to make them available.

Each ref name should either be found on the `ref` property of the job or in the
`tags` array.

Each file takes the following form:

```javascript
{ branch "benchmarks", "benchmarks/inserts.js" }
```

These are only other files in the repository. This feature is meant to allow
you to either keep all benchmarking code in its own branch or to run these
benchmarks on old tags that do not have the benchmarks in them.

Extending the Charts
====================

The charts are fairly easy to extend in functionality. You can add to the
existing grapher by submitting pull requests to
[gh-benchmarks-grapher](https://github.com/ebensing/gh-benchmarks-grapher) or
by creating your own module. Installation/specs are below

You can see where we import the grapher at around [line
28](https://github.com/ebensing/gh-benchmarks/blob/master/app.js#L28) in
app.js. To install your new grapher, simply change this one line.

A grapher module must export 1 method, `buildGraphs`

`exports.buildGraphs = function (runs, job, repo_loc, callback) {`

buildGraphs will receive the following parameters:

1. runs - This is an array of the mongoose objects that represent a run. Their
   schema can be found in
   [model.js](https://github.com/ebensing/gh-benchmarks/blob/master/models.js) 
2. job - This is the job that the runs belong to. The job's schema can also be
   found in
   [model.js](https://github.com/ebensing/gh-benchmarks/blob/master/models.js)
   as "JobDesc"
3. repo_loc - This is the location of the repo relative to the current working
   directory
4. callback - This is the callback function to fire when the grapher finishes
   running. It has the following signature: `function callback(error, files)`
   where `files` is an array of strings of the file names that were modified or
   added to the repo. These names should be relative to the root directory *of
   the repository*
