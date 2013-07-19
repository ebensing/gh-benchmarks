#!/bin/bash

NODE=`which node`

echo "Checking to see if node is installed..."
if [ ! $NODE ]; then
  echo "Installing Node.js"
  sudo apt-get install python-software-properties python g++ make
  sudo add-apt-repository ppa:chris-lea/node.js
  sudo apt-get update
  sudo apt-get install nodejs
  echo "Node.js installed!"
fi

echo "Checking to see if MongoDB is installed..."

MONGO=`which mongod`
if [ ! $MONGO ]; then
  echo "Installing MongoDB"
  sudo apt-key adv --keyserver keyserver.ubuntu.com --recv 7F0CEB10
  echo 'deb http://downloads-distro.mongodb.org/repo/ubuntu-upstart dist 10gen' | sudo tee /etc/apt/sources.list.d/10gen.list
  sudo apt-get update
  sudo apt-get install mongodb-10gen
  echo "MongoDB installed!"
fi

echo "Checking to see if git is installed..."

GIT=`which git`
if [ ! $GIT ]; then
  echo "Installing git"
  sudo apt-get install git-core
  echo "Git installed!"
fi

echo "Checking to see if sendmail is installed..."
MAIL=`which sendmail`
if [ ! $MAIL ]; then
  echo "Installing sendmail"
  sudo apt-get install sendmail
  echo "Sendmail installed!"
fi

echo "Installing node modules..."
npm install -d

echo "Setup complete. All dependencies have been installed"
