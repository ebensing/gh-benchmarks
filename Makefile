
all:
	docker build -t gh-benchmarks/main .

run:
	docker run -e GH_WD='/src' -i -t -d gh-benchmarks/main

start:
	./start.sh

runfailed:
	curl http://localhost:8081/?command=runFailed
