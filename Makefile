LOGPATH=/home/ubuntu/gh-benchmarks

all:
	docker build -t gh-benchmarks/main .

run:
	docker run -e GH_WD='/src' -i -t -d gh-benchmarks/main

start:
	mkdir -p ./logs/
	forever start -a -l $(LOGPATH)/logs/forever.log -o $(LOGPATH)/logs/out.log -e $(LOGPATH)/logs/err.log app.js

runfailed:
	curl http://localhost:8081/?command=runFailed
