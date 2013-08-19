
all:
	docker build -t gh-benchmarks/main .

run:
	docker run -e GH_WD='/src' -i -t -d gh-benchmarks/main

start:
	mkdir -p ./logs
	forever start app.js -l ./logs/forever.log -o ./logs/out.log -e ./logs/err.log

runfailed:
	curl http://localhost:8081/?command=runFailed
