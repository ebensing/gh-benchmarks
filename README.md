
Github Benchmarks
=====================

This project enables you to easily setup benchmarks for any Github repo. 
Basically, TravisCI but for benchmarks.

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
3. [SendMail](http://www.sendmail.com/sm/open_source/)
4. [Git](https://help.github.com/articles/set-up-git#platform-all)

5. After all of these dependencies have been installed, run `npm install -d`
   from the root directory of the project

And that's it! All of the necessary dependencies should be installed. Now, you
just need to setup the config and you should be good to go

Overview
====================

First, an overview on how gh-benchmarks functions. First, it is meant to be
language agnostic- if you set everything up correctly, this should be able to
do benchmarks for any piece of software.

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
6. After all of the tasks have completed, the system then generates the charts
   specified in the config file.
7. Finally, these charts are then committed and pushed to Github (by default,
   in the gh-pages branch)

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
      // This tells us whether the ref is a tag
      isTag : false,
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
      // version of the repository 
      preservedFiles : [
        { "branch" : "benchmarks", "name" : "benchmarks/main.js" }
      ]
    }

Job Fields
====================
