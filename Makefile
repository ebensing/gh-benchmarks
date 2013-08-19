
all:
	docker build -t gh-benchmarks/main .

run:
	docker run -e GH_WD='/src' -i -t -d gh-benchmarks/main

start:
	forever start app.js -l /home/ubuntu/gh-benchmarks/logs
