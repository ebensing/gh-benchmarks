
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

function push_origin(repo_loc, remote, branch, cb) {
  var command = utils.format("cd %s && git push %s %s", repo_loc, remote, branch);
  exec(command, cb);
}

exports.clone = clone_repo;

exports.checkout_ref = checkout_ref;

