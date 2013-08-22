#!/bin/bash

LOGPATH=/home/ubuntu/gh-benchmarks

mkdir -p ./logs/
echo "Please enter your Github username:"
read username
echo "Please enter your Github password:"
read password
export githubUsername=$username 
export githubPassword=$password 
forever start -a -l $LOGPATH/logs/forever.log -o $LOGPATH/logs/out.log -e $LOGPATH/logs/err.log app.js
