
// this is where the logic to run all the Git commands will live

var exec = require('child_process').exec;
var utils = require('util');

/**
 * clones a Git repo
 *
 * @param {String} url - assumes it is a Github url
 * @param {Function} cb - callback
 */

function clone_repo(url, cb) {
  var repoName = url.replace("git@github.com:","").replace(".git","").replace("/","-");
  exec(utils.format("git clone %s repos/%s", url, repoName), function (err, stdout, stderr) {
    if (err) return cb(err);

    return cb(null, "repos/" + repoName);
  });
}

/**
 * Checkout a specified ref
 *
 * @param {String} repo_loc - location of the repo on disk
 * @param {String} ref - name of the ref to checkout ie. "master"
 * @param {Function} cb - callback
 */

function checkout_ref(repo_loc, ref, cb) {
  var command = utils.format("cd %s && git fetch origin %s && git checkout %s", repo_loc, ref, ref);
  exec(command, cb);
}

/**
 * Pushes a specific branch to a specific remote
 *
 * @param {String} repo_loc - location of the repo on disk
 * @param {String} remote - name of the remote
 * @param {String} branch - name of the branch
 * @param {Function} cb - callback
 */

function push_repo(repo_loc, remote, branch, cb) {
  var command = utils.format("cd %s && git push %s %s", repo_loc, remote, branch);
  exec(command, cb);
}

/**
 * Stage a set of files for commit
 *
 * @param {String} repo_loc - location of the repo on disk
 * @param {Array} fileNames - list of file names to stage
 * @param {Function} cb - callback
 */

function add_files(repo_loc, fileNames, cb) {
  // in case people decide to only pass a single file, let's not blow up in
  // their face
  if ('string' == typeof fileNames) {
    filesNames = [fileNames];
  }
  var count = fileNames.length;
  next(0);

  function next(i) {
    var command = utils.format("cd %s && git add %s", repo_loc, fileNames[i]);
    exec(command, function (err) {
      if (err) return cb(err);

      count--;
      if (count) {
        next(i + 1);
      } else {
        cb();
      }
    });
  }
}

/**
 * Commits a repo
 *
 * @param {String} repo_loc - location of the repository
 * @param {String} commitMsg - commit message to go with the commit
 * @param {Function} cb - callback
 */

function commit_repo(repo_loc, commitMsg, cb) {
  var command = utils.format("cd %s && git commit -m '%s'", repo_loc, commitMsg);
  exec(command, cb);
}

exports.clone = clone_repo;

exports.checkout_ref = checkout_ref;

exports.add_files = add_files;

exports.commit_repo = commit_repo;

exports.push_repo = push_repo;
