
// this file contains all the graphing logic for the benchmark graphs


$("document").ready(function () {
  $.getJSON('data.json', function (jsonData) {
    var data = jsonData.data;
    var charts = jsonData.charts;
    // loop over the charts and create them
    for (var i=0; i < charts.length; i++) {
      var chartDesc = charts[i];
      var chartData = data[i];
      var container = "body";

      $("<div></div>").attr("id", "div"+i).appendTo(container);
      var selector = "#div%id%".replace("%id%",i.toString());
      switch(chartDesc.type) {
        case "singleBar":
          buildBarGraph(selector, chartDesc, chartData);
          break;
      }

    }
  });
});

function buildBarGraph(selector, chartDesc, chartData) {

  $("<h1 class='chartTitle'>%title%</h1>".replace("%title%",chartDesc.title))
    .appendTo(selector);

  var xData = chartData.map(function (item) {
    return item.x;
  });
  var yData = chartData.map(function (item) {
    return item.y;
  });

  var w = 100,
      h = 400;

  var x = d3.scale.linear()
    .domain([0, 1])
    .range([0, w]);

  var y = d3.scale.linear()
    .domain([0, d3.max(yData) * 1.25])
    .rangeRound([0,h]);


  var totalWidth = w * chartData.length - 1;

  // create the chart
  var chart = d3.select(selector).append("svg")
    .attr("class", "chart")
    .attr("width", totalWidth + 50)
    .attr("height", h + 50)
    .append("g").attr("transform", "translate(10,15)");

  // add the data rectangles (these are the bars)
  chart.selectAll("rect").data(chartData).enter().append("rect")
    .attr("x", function(d, i) { return x(i) - .5; })
    .attr("y", function(d, i) { return h - y(d.y) - .5; })
    .attr("width", w * .75)
    .attr("height", function(d) { return y(d.y); });

  // add the labels for each bar (essentially their x-value)
  chart.selectAll("text").data(chartData).enter().append("text")
    .attr("x", function(d, i) { return i * w + (w*.75/2); })
    .attr("y", h - 10)
    .attr("dx", -3)
    .attr("text-anchor", "middle")
    .text(function(d) { return d.x; });

  // add the value labels for each bar (essentially their y-value)
  chart.selectAll(".value").data(chartData).enter().append("text")
    .attr("class", "value")
    .attr("x", function(d, i) { return i * w + (w*.75/2); })
    .attr("y", function(d, i) { return h - y(d.y) - 5; })
    .attr("dx", -3)
    .attr("text-anchor", "middle")
    .text(function(d) { return d.y; });

  // add horizontal lines for scale
  chart.selectAll("line").data(y.ticks(10)).enter().append("line")
    .attr("x1", 0)
    .attr("x2", totalWidth - (w * .25) + 3)
    .attr("y1", y)
    .attr("y2", y)
    .style("stroke", "#ccc");

  // add the scale labels
  chart.selectAll(".rule").data(y.ticks(10)).enter().append("text")
    .attr("class", "rule")
    .attr("y", function(d,i) { return h - y(d);})
    .attr("x", totalWidth)
    .attr("dx", -(w/15))
    .attr("dy", 6)
    .attr("text-anchor", "middle")
    .text(String);

  // add a line at the base
  chart.append("line")
    .attr("x1", 0)
    .attr("x2", totalWidth - (w * .25) + 3)
    .attr("y1", h - .5)
    .attr("y2", h - .5)
    .style("stroke", "#000");

}
