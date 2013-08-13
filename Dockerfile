#DOCKER-VERSION 0.5.1

from  ubuntu:12.04

RUN   apt-get update
RUN   apt-get install python-software-properties python g++ make git-core openssh-server -y
RUN   add-apt-repository ppa:chris-lea/node.js
RUN   echo "deb http://archive.ubuntu.com/ubuntu precise universe" >> /etc/apt/sources.list
RUN   apt-get update
RUN   apt-get install nodejs -y
RUN   echo "    IdentityFile ~/.ssh/id_rsa" >> /etc/ssh/ssh_config

ADD   . /src
ADD   ../../home/ubuntu/.ssh/id_rsa /root/.ssh/id_rsa
ADD   ../../home/ubuntu/.ssh/known_hosts /root/.ssh/known_hosts
ADD   ./docker/hosts /etc/hosts
RUN   cd /src; npm install

EXPOSE  8080:8080

CMD   [ "node", "/src/app.js" ]
