
// these are all of the config options for the server

/**
 * This is the URI for the mongod instance which will store the results and
 * data.
 */

exports.mongoDBuri = "mongodb://localhost/gh-benchmarks-test";


/**
 * This the port that the server will run on. Defaults to port 8080
 */

exports.port = 8080;

/**
 * This is the Github URL
 */

exports.githubUri = "https://github.com/";

/**
 * This is the API url
 */

exports.githubApiUri = "api.github.com";

/**
 * This is the file that contains the jobs
 */

exports.jobsFile = "./config/test.json";

/**
 * This is the file that contains the email config
 */

exports.emailFile = "./config/email.json";

/**
 * This is the outside URL that you ping to access this service. Used for
 * creating pull request web hook.
 */

exports.local_url = "http://54.221.203.72";
