/*
 *  Power BI Visualizations
 *  
 *  Hexbin Scatterplot 
 *  v0.9.7
 *
 *  Copyright (c) David Eldersveld, BlueGranite Inc.
 *  All rights reserved. 
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *   
 *  The above copyright notice and this permission notice shall be included in 
 *  all copies or substantial portions of the Software.
 *   
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 *
 *  Acknowledgements:
 *  Calculations for bin assignment and hexagon placement found in assignHexbin()
 *      and buildHexagon() adapted from the d3.hexbin plugin: 
 *      https://github.com/d3/d3-plugins/tree/master/hexbin
 *
 *  +JMJ+
 */

/* Please make sure that this path is correct */
//-/// <reference path="../_references.ts"/>

module powerbi.visuals {

    import SelectionManager = utility.SelectionManager;
	import ValueFormatter = powerbi.visuals.valueFormatter;
    export interface ScatterHexbinData {
        category: string;
        xValue: number;
        yValue: number;
        sizeValue: number;
        selector: SelectionId;
        tooltipInfo: TooltipDataItem[];
    };
    
    export class ScatterHexbin implements IVisual {

        public static capabilities: VisualCapabilities = {
            dataRoles: [
                {
                    name: "Category",
                    kind: VisualDataRoleKind.Grouping,
                    displayName: "Details"
                },
                {
                    name: "X",
                    kind: VisualDataRoleKind.Measure,
                    displayName: data.createDisplayNameGetter('Role_DisplayName_X'),
                    description: data.createDisplayNameGetter('Role_DisplayName_XScatterChartDescription'),
                    requiredTypes: [{ numeric: true }, { integer: true }],
                },
                {
                    name: "Y",
                    kind: VisualDataRoleKind.Measure,
                    displayName: data.createDisplayNameGetter('Role_DisplayName_Y'),
                    description: data.createDisplayNameGetter('Role_DisplayName_YScatterChartDescription'),
                    requiredTypes: [{ numeric: true }, { integer: true }],
                },
                {
                    name: "Value",
                    kind: VisualDataRoleKind.Measure,
                    displayName: "Value",
                    description: "When Value is absent, hexbin color saturation is based on density. When Value is present, saturation is based on Value.",
                    requiredTypes: [{ numeric: true }, { integer: true }],
                }
            ],
            dataViewMappings: [{
                categorical: {
                    categories: {
                        for: { in: "Category" }
                    },
                    values: {
                        select: [{ bind: { to: 'X' } },
                            { bind: { to: 'Y' } },
                            { bind: { to: 'Value' } }
                        ]
                    }
                },
				conditions: [{
                    "Category": { max: 1 },
					"X": { max: 1 },
					"Y": { max: 1 },
					"Value": { max: 1 }
				}],
            }],
            objects: {
                general: {
                    displayName: data.createDisplayNameGetter('Visual_General'),
                    properties: {
                        formatString: StandardObjectProperties.formatString,
                    },
                },
                color: {
                    displayName: 'Color',
                    properties: {
                        fill: {
                            type: { fill: { solid: { color: true } } },
                            displayName: 'Fill'
                        },
                    },
                },
                size: {
                    displayName: 'Size',
                    properties: {
                        hexRadius: {
                            //type: { numeric: true },
                            type: {formatting: { fontSize: true } },
                            displayName: 'Bin radius',
                        },
                    },
                },
                displayOptions: {
                    displayName: 'Display',
                    properties: {
                        showDots: {
                            displayName: 'Dots',
                            type: { bool: true }
                        },
                        showBins: {
                            displayName: 'Hexbins',
                            type: { bool: true }
                        },
                        showRug: {
                            displayName: 'Rug',
                            type: { bool: true }
                        },
                    }
                },
                
            },
        };

        private svg: D3.Selection;
        private mainChart: D3.Selection;
        private hexGroup: D3.Selection;
        private dotGroup: D3.Selection;
        private xAxisTicks: D3.Selection;
        private yAxisTicks: D3.Selection;
        private xAxisLabel: D3.Selection;
        private yAxisLabel: D3.Selection;
        private selectionManager: SelectionManager;
        private dataView: DataView;
        
        private static properties = {
            hexRadius: {objectName: "size", propertyName: "hexRadius"},
            showDots: {objectName: "displayOptions", propertyName: "showDots"},
            showBins: {objectName: "displayOptions", propertyName: "showBins"},
            showRug: {objectName: "displayOptions", propertyName: "showRug"}
        }
        
        private getHexRadius(dataView: DataView): number { return dataView == null ? 0 : DataViewObjects.getValue(dataView.metadata.objects, ScatterHexbin.properties.hexRadius, 10); }
        private getShowDots(dataView: DataView): boolean { return dataView == null ? false : DataViewObjects.getValue(dataView.metadata.objects, ScatterHexbin.properties.showDots, true); }
        private getShowBins(dataView: DataView): boolean { return dataView == null ? false : DataViewObjects.getValue(dataView.metadata.objects, ScatterHexbin.properties.showBins, true); }
        private getShowRug(dataView: DataView): boolean { return dataView == null ? false : DataViewObjects.getValue(dataView.metadata.objects, ScatterHexbin.properties.showRug, true); }

        public static converter(dataView: DataView): any {
			if (!dataView ||
				!dataView.categorical ||
				!dataView.categorical.categories ||
				!dataView.categorical.categories[0] ||
				!dataView.categorical.categories[0].values ||
				!dataView.categorical.categories[0].values.length) {
				return null;
			}
			
			if (!dataView.categorical.values ||
				!dataView.categorical.values[0] ||
				!dataView.categorical.values[0].values ||
				!dataView.categorical.values[0].values.length) {
				return null;
			}
			var xAxisFormatter: IValueFormatter = null;	
			var yAxisFormatter: IValueFormatter = null;
            var measureValueFormatter: IValueFormatter = null;
            var catDv: DataViewCategorical = dataView.categorical;
            var cat = catDv.categories[0];
            var catValues = cat.values;
            var values = catDv.values;

            var formatStringProp = <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'formatString' };
            var categorySourceFormatString = valueFormatter.getFormatString(cat.source, formatStringProp);

            var dataArray: ScatterHexbinData[] = [];

            var colIndex = {
                x: null,
                y: null,
                value: null
            };

            if (values[0].source.roles) {
                for (var j = 0, len = values.length; j < len; j++) {
                    var cols = values[j].source.roles;
                    var colKey = Object.keys(cols);
					
					for (var keyIndex = 0, lenColKey = colKey.length; keyIndex < lenColKey; keyIndex++) {
						if (colKey[keyIndex] === "X") { colIndex.x = j; }
						if (colKey[keyIndex] === "Y") { colIndex.y = j; }
						if (colKey[keyIndex] === "Value") { colIndex.value = j; }
					}
                }
            }
            else {
                colIndex = { "x": 0, "y": 1, "value": 2 };
            }
			
			if (colIndex.x  == null || colIndex.y  == null) {
				return null;
			}
			
			/*if (catValues.length) {
				xAxisFormatter = ValueFormatter.create({
					format: ValueFormatter.getFormatString(values[colIndex.x].source, formatStringProp),
					value: values[colIndex.x].values[0]
				});
				if (values[colIndex.y]) {
					yAxisFormatter = ValueFormatter.create({
						format: ValueFormatter.getFormatString(values[colIndex.y].source, formatStringProp),
						value: values[colIndex.y].values[0]
					});
				}
			}*/
			
            console.log("xIndexValues", values[colIndex.x]);
            console.log("yIndexValues", values[colIndex.y]);
            
			if (values[colIndex.x]) {
				xAxisFormatter = ValueFormatter.create({
					format: ValueFormatter.getFormatString(values[colIndex.x].source, formatStringProp),
					value: values[colIndex.x].values[0]
				});
			}
			if (values[colIndex.y]) {
				yAxisFormatter = ValueFormatter.create({
					format: ValueFormatter.getFormatString(values[colIndex.y].source, formatStringProp),
					value: values[colIndex.y].values[0]
				});
			}
            if (values[colIndex.value]) {
				measureValueFormatter = ValueFormatter.create({
					format: ValueFormatter.getFormatString(values[colIndex.value].source, formatStringProp),
					value: values[colIndex.value].values[0]
				});
			}
		
			console.log("xAxisFormatter", xAxisFormatter);
            console.log("yAxisFormatter", yAxisFormatter);
			
            for (var i = 0, len = catValues.length; i < len; i++) {
                var formattedCategoryValue = valueFormatter.format(catValues[i], categorySourceFormatString);

                var tooltipInfo: TooltipDataItem[] = TooltipBuilder.createTooltipInfo(
                    formatStringProp,
                    dataView.categorical,
                    formattedCategoryValue,
                    values[0].values[i],
                    values[0].values[i],
                    null,
                    0);

                if (values.length > 1) {
                    var toolTip = TooltipBuilder.createTooltipInfo(
                        formatStringProp,
                        dataView.categorical,
                        formattedCategoryValue,
                        values[1].values[i],
                        values[1].values[i],
                        null,
                        1)[1];
                    if (toolTip) {
                        tooltipInfo.push(toolTip);
                    }
                }

                if (values.length > 2) {
                    var toolTip = TooltipBuilder.createTooltipInfo(
                        formatStringProp,
                        dataView.categorical,
                        formattedCategoryValue,
                        values[2].values[i],
                        values[2].values[i],
                        null,
                        2)[1];
                    if (toolTip) {
                        tooltipInfo.push(toolTip);
                    }
                }

                dataArray.push({
                    category: catValues[i],
                    xValue: values[colIndex.x].values[i] == null ? 0: values[colIndex.x].values[i],
                    yValue: values[colIndex.y].values[i] == null ? 0: (values.length > 1 ? values[colIndex.y].values[i] : 1),
                    sizeValue: values.length > 2 ? values[colIndex.value].values[i] : 1,
                    selector: SelectionId.createWithId(cat.identity[i]),
                    tooltipInfo: tooltipInfo
                });
            }

            return  {
				dataArray: dataArray,
				xAxisFormatter: xAxisFormatter,
				yAxisFormatter: yAxisFormatter,
                measureValueFormatter: measureValueFormatter};
        }

        public init(options: VisualInitOptions): void {

            this.svg = d3.select(options.element.get(0))
                .append('svg')
                .attr("class", "svgHexbinContainer")
                .attr("height", options.viewport.height)
                .attr("width", options.viewport.width);

            this.mainChart = this.svg.append('g')
                .attr("class", "mainChartGroup");

            this.hexGroup = this.mainChart.append("g")
                .attr("class", "hexGroup");

            this.dotGroup = this.mainChart.append("g")
                .attr("class", "dotGroup");

            this.xAxisTicks = this.mainChart.append("g")
                .attr("class", "axis")
                .attr("id", "xAxis");

            this.yAxisTicks = this.mainChart.append("g")
                .attr("class", "axis")
                .attr("id", "yAxis");

            this.xAxisLabel = this.xAxisTicks.append("text")
                .attr("class", "label")
                .attr("id", "xAxisLabel");

            this.yAxisLabel = this.yAxisTicks.append("text")
                .attr("class", "label")
                .attr("id", "yAxisLabel");

            this.selectionManager = new SelectionManager({ hostServices: options.host });
        }

        public update(options: VisualUpdateOptions) {
            this.svg
                .attr("height", options.viewport.height)
                .attr("width", options.viewport.width);

            this.dataView = options.dataViews[0];
			
			if (!this.dataView) {
				return;
			}
            
            //clear any notification text
            this.mainChart.select(".note-text").remove();
            
            //hide labels if rendered and then fields are later removed
            this.mainChart.selectAll(".axis").selectAll(".label").attr("visibility", "visible");
            
            //viewport check - don't render if too small
            if(options.viewport.height < 99 || options.viewport.width < 120){
                
                this.cleanup();
                this.addNotification("Visual is too small to render");
                return;
            }
            

            var chartData = ScatterHexbin.converter(options.dataViews[0]);
            
            try{
	            var dataArray = chartData.dataArray;
            }
            catch(e){
                //remove elements if required data is unavailable
                this.cleanup();
                
                //add notification if required fields not available
                this.addNotification("Add data to Details, X Axis and Y Axis to display the Hexbin Scatterplot");
            }
            var fillColor = this.getFill(this.dataView).solid.color;
            var hexRadius = options.viewport.width * this.getHexRadius(this.dataView) / 200;
            var transitionDuration = 1000;
            var rugLength = 5;
            var dotSize = "2px";
			var xAxisFormatter = chartData.xAxisFormatter;
			var yAxisFormatter = chartData.yAxisFormatter;
            var measureValueFormatter = chartData.measureValueFormatter;
            
            //Used in place of DataRoleHelper
            var colMetaIndex = {
                category: null,
                x: null,
                y: null,
                value: null
            };
			
            if (this.dataView.metadata.columns[0].roles) {
                var meta = this.dataView.metadata.columns;
                for (var j in meta) {
                    var cols = meta[j].roles;
                    var colKey = Object.keys(cols);
                    //SWITCH not working but multiple IFs do
                    if (colKey[0] === "Category") { colMetaIndex.category = j; }
                    if (colKey[0] === "X") { colMetaIndex.x = j; }
                    if (colKey[0] === "Y") { colMetaIndex.y = j; }
                    if (colKey[0] === "Value") { colMetaIndex.value = j; }
                }
            }
            else {
                colMetaIndex = { "category": 0, "x": 1, "y": 2, "value": 3 };
            }
			
			if (!this.dataView.metadata.columns[colMetaIndex.x]
				||!this.dataView.metadata.columns[colMetaIndex.y]) {
				return;
			}

            var margin = { top: 20, right: 5, bottom: 20, left: 50 };
            var w = options.viewport.width - margin.left - margin.right;
            var h = options.viewport.height - margin.bottom;
            var padding = 100;
            var hexGroup = this.hexGroup;
            var dotGroup = this.dotGroup;
            var xAxisTicks = this.xAxisTicks;
            var yAxisTicks = this.yAxisTicks;
            var xAxisLabel = this.xAxisLabel;
            var yAxisLabel = this.yAxisLabel;
            var xMeta = this.dataView.metadata.columns[colMetaIndex.x].displayName;
            var yMeta = this.dataView.metadata.columns[colMetaIndex.y].displayName;
            var valueMeta = (!this.dataView.metadata.columns[colMetaIndex.value])
                ? "Value" : this.dataView.metadata.columns[colMetaIndex.value].displayName;

            var selectionManager = this.selectionManager;

            var xScale = d3.scale.linear()
                .domain(d3.extent(dataArray, function (d) {
                    var v = getXValue(d);
                    return v;
                })).nice()
                .range([rugLength + 5, w - rugLength - 5]);

            var yScale = d3.scale.linear()
                .domain(d3.extent(dataArray, function (d) {
                    var v = getYValue(d);
                    return v;
                })).nice()
                .range([h - margin.bottom - rugLength - 5, margin.top]);

            var xAxis = d3.svg.axis()
                .scale(xScale)
                .orient("bottom")
                .ticks(Math.floor(w / 75))
                .tickFormat(function(d) { return xAxisFormatter ? xAxisFormatter.format(d) : d; });

            var yAxis = d3.svg.axis()
                .scale(yScale)
                .orient("left")
                .ticks(Math.floor(h / 40))
                .tickFormat(function(d) { return yAxisFormatter ? yAxisFormatter.format(d) : d; });

            xAxisTicks
                .attr("transform", "translate(" + margin.left + "," + (h - margin.bottom) + ")")
                .call(xAxis);

            xAxisLabel
                .attr("transform", "translate(" + (w / 2) + "," + (margin.bottom + 6) + ")")
                .style("text-anchor", "middle")
                .text(xMeta);

            yAxisTicks
                .attr("transform", "translate(" + margin.left + "," + 0 + ")")
                .call(yAxis);

            yAxisLabel
                .attr("transform", "translate(" + (-margin.left + 9) + "," + (h / 2) + ") rotate(-90)")
                .style("text-anchor", "middle")
                .text(yMeta);

            //hexbin main
            if (this.getShowBins(this.dataView)) {
                makeHexbins();
            }
            else {
                hexGroup.selectAll(".hexagon").remove();
            }
            
            //dot main
            if (this.getShowDots(this.dataView)) {
                makeDots();
            }
            else {
                dotGroup.selectAll(".dot").remove();
            }
            //rug main
            if (this.getShowRug(this.dataView)) {
                layRugs();
            }
            else {
                dotGroup.selectAll(".x-rug").remove();
                dotGroup.selectAll(".y-rug").remove();
            }

            function getXValue(d): number {
                return d.xValue;
            }

            function getYValue(d): number {
                return d.yValue;
            }

            function getSizeValue(d): number {
                return d.sizeValue;
            }

            function makeDots() {
                var dot = dotGroup.selectAll(".dot")
                    .data(dataArray);

                dot.enter()
                    .append("circle")
                    .attr("class", "dot")
                    .attr("transform", "translate(" + margin.left + "," + 0 + ")")
                    .attr("r", dotSize)
                    .attr("cx", function (d) { var v = getXValue(d); return xScale(v); })
                    .attr("cy", function (d) { var v = getYValue(d); return yScale(v); });

                dot.transition()
                    .duration(transitionDuration)
                    .attr("cx", function (d) { var v = getXValue(d); return xScale(v); })
                    .attr("cy", function (d) { var v = getYValue(d); return yScale(v); });

                dot.on("click", function (d) {
                    selectionManager.select(d.selector).then(ids => {
                        if (ids.length > 0) {
                            dot.style('opacity', 1);
                            d3.select(this).style('opacity', 1);
                        }
                        else {
                            dot.style('opacity', 1);
                        }
                    });
                });

                dot.exit()
                    .transition()
                    .duration(transitionDuration)
                    .remove();

                TooltipManager.addTooltip(dot, (tooltipEvent: TooltipEvent) => tooltipEvent.data.tooltipInfo);
            }

            function layRugs() {
                var xRug = dotGroup.selectAll(".x-rug")
                    .data(dataArray);

                var yRug = dotGroup.selectAll(".y-rug")
                    .data(dataArray);

                xRug.enter()
                    .append("line")
                    .attr("class", "x-rug")
                    .attr("transform", "translate(" + margin.left + "," + 0 + ")")
                    .attr("x1", function (d) { var v = getXValue(d); return xScale(v); })
                    .attr("y1", options.viewport.height - (margin.bottom * 2))
                    .attr("x2", function (d) { var v = getXValue(d); return xScale(v); })
                    .attr("y2", options.viewport.height - (margin.bottom * 2) - rugLength);

                xRug.transition()
                    .duration(100)
                    .attr("x1", function (d) { var v = getXValue(d); return xScale(v); })
                    .attr("y1", options.viewport.height - (margin.bottom * 2))
                    .attr("x2", function (d) { var v = getXValue(d); return xScale(v); })
                    .attr("y2", options.viewport.height - (margin.bottom * 2) - rugLength);

                xRug.exit()
                    .transition()
                    .duration(100)
                    .remove();

                yRug.enter()
                    .append("line")
                    .attr("class", "x-rug")
                    .attr("transform", "translate(" + margin.left + "," + 0 + ")")
                    .attr("x1", 0)
                    .attr("y1", function (d) { var v = getYValue(d); return yScale(v); })
                    .attr("x2", rugLength)
                    .attr("y2", function (d) { var v = getYValue(d); return yScale(v); });

                yRug.transition()
                    .duration(100)
                    .attr("x1", 0)
                    .attr("y1", function (d) { var v = getYValue(d); return yScale(v); })
                    .attr("x2", rugLength)
                    .attr("y2", function (d) { var v = getYValue(d); return yScale(v); });

                yRug.exit()
                    .transition()
                    .duration(100)
                    .remove();
            }

            function makeHexbins() {

                function assignHexbin(points, hexRadius) {

                    var r = hexRadius;
                    var dx = r * 2 * Math.sin(Math.PI / 3);
                    var dy = r * 1.5;

                    var binsById = {};

                    points.forEach(function (point, i) {
                        var origX = xScale(getXValue(point));
                        var origY = yScale(getYValue(point));

                        var py = origY / dy;
                        var pj = Math.round(py);
                        var px = origX / dx - (pj & 1 ? .5 : 0);
                        var pi = Math.round(px);
                        var py1 = py - pj;

                        if (Math.abs(py1) * 3 > 1) {
                            var px1 = px - pi;
                            var pi2 = pi + (px < pi ? -1 : 1) / 2;
                            var pj2 = pj + (py < pj ? -1 : 1);
                            var px2 = px - pi2;
                            var py2 = py - pj2;
                            if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
                                pi = pi2 + (pj & 1 ? 1 : -1) / 2;
                                pj = pj2;
                            }
                        }

                        var id = pi + "-" + pj;
                        var bin = binsById[id];
                        if (bin) bin.push(point); else {
                            bin = binsById[id] = [point];
                            bin.i = pi;
                            bin.j = pj;
                            bin.x = (pi + (pj & 1 ? 1 / 2 : 0)) * dx;
                            bin.y = pj * dy;
                        }
                    });

                    var addStats = d3.values(binsById);
                    for (var i in addStats) {
                        var agg = d3.nest()
                            .rollup(function (leaves) {
                                return {
                                    binCount: leaves.length,
                                    xMean: d3.mean(leaves, function (d) { return getXValue(d); }),
                                    yMean: d3.mean(leaves, function (d) { return getYValue(d); }),
                                    valueSum: d3.sum(leaves, function (d) { return getSizeValue(d); }),
                                    valueMean: d3.mean(leaves, function (d) { return getSizeValue(d); }),
                                    valueMedian: d3.median(leaves, function (d) { return getSizeValue(d); }),
                                    valueMin: d3.min(leaves, function (d) { return getSizeValue(d); }),
                                    valueMax: d3.max(leaves, function (d) { return getSizeValue(d); }),
                                };
                            })
                            .entries(addStats[i]);
                        addStats[i].stats = agg;
                    }
                    return addStats;
                }

                function buildHexagon(radius) {
                    var x0 = 0, y0 = 0;
                    var d3_hexbinAngles = d3.range(0, 2 * Math.PI, Math.PI / 3);
                    return "m" + d3_hexbinAngles.map(function (angle) {
                        var x1 = Math.sin(angle) * radius;
                        var y1 = -Math.cos(angle) * radius;
                        var dx = x1 - x0;
                        var dy = y1 - y0;
                        x0 = x1;
                        y0 = y1;
                        return [dx, dy];
                    });
                }

                var hexData = assignHexbin(dataArray, hexRadius);
                var fill = fillColor;

                var hexColor = d3.scale.linear()
                    .domain(d3.extent(hexData, function (d) { return d.stats.valueSum; })).nice()
                    .range(["rgb(233, 233, 233)", fill])
                    .interpolate(d3.interpolateLab);

                var hex = hexGroup.selectAll(".hexagon")
                    .data(hexData);

                hex.enter()
                    .append("path")
                    .attr("class", "hexagon")
                    .attr("d", buildHexagon(hexRadius))
                    .attr("transform", function (d) { return "translate(" + (d.x + margin.left) + "," + (d.y) + ")"; })
                    .style("fill", function (d) { return hexColor(d.stats.valueSum); })
                    .style("stroke", "#FFFFFF")
                    .style("stroke-width", "1px");

                hex.transition()
                    .duration(transitionDuration)
                    .attr("d", buildHexagon(hexRadius))
                    .attr("transform", function (d) {
                        return "translate(" + (d.x + margin.left) + "," + (d.y) + ")";
                    })
                    .style("fill", function (d) {
                        return hexColor(d.stats.valueSum);
                    });

                hex.exit()
                    .transition()
                    .duration(transitionDuration)
                    .remove();

                for (var i in hexData) {
                    if (valueMeta === "Value") {
                        hexData[i].tooltipInfo = [
                            { displayName: "Bin statistics", value: "" },
                            { displayName: "Count", value: hexData[i].stats.binCount },
                            { displayName: "Mean " + xMeta, value: xAxisFormatter ? xAxisFormatter.format(parseFloat(hexData[i].stats.xMean.toFixed(2))) : parseFloat(hexData[i].stats.xMean.toFixed(2)) },
                            { displayName: "Mean " + yMeta, value: yAxisFormatter ? yAxisFormatter.format(parseFloat(hexData[i].stats.yMean.toFixed(2))) : parseFloat(hexData[i].stats.yMean.toFixed(2)) },
                        ];
                    }
                    else {
                        hexData[i].tooltipInfo = [
                            { displayName: "Bin statistics", value: "" },
                            { displayName: "Count", value: hexData[i].stats.binCount },
                            { displayName: "Mean " + xMeta, value: xAxisFormatter ? xAxisFormatter.format(parseFloat(hexData[i].stats.xMean.toFixed(2))) : parseFloat(hexData[i].stats.xMean.toFixed(2)) },
                            { displayName: "Mean " + yMeta, value: yAxisFormatter ? yAxisFormatter.format(parseFloat(hexData[i].stats.yMean.toFixed(2))) : parseFloat(hexData[i].stats.yMean.toFixed(2)) },
                            { displayName: "Sum of " + valueMeta, value: parseFloat(hexData[i].stats.valueSum.toFixed(2)) },
                            { displayName: "Mean " + valueMeta, value: parseFloat(hexData[i].stats.valueMean.toFixed(2)) },
                            { displayName: "Median " + valueMeta, value: parseFloat(hexData[i].stats.valueMedian.toFixed(2)) },
                            { displayName: "Minimum " + valueMeta, value: parseFloat(hexData[i].stats.valueMin.toFixed(2)) },
                            { displayName: "Maximum " + valueMeta, value: parseFloat(hexData[i].stats.valueMax.toFixed(2)) },
                        ];
                    }
                }
                TooltipManager.addTooltip(hex, (tooltipEvent: TooltipEvent) => tooltipEvent.data.tooltipInfo);
            }

        }

        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] {
            var instances: VisualObjectInstance[] = [];
            switch (options.objectName) {
                case 'color':
                    var color: VisualObjectInstance = {
                        objectName: 'color',
                        displayName: 'Color',
                        selector: null,
                        properties: {
                            fill: this.getFill(this.dataView)
                        }
                    };
                    instances.push(color);
                    break;
                case 'size':
                    var size: VisualObjectInstance = {
                        objectName: 'size',
                        displayName: 'Size',
                        selector: null,
                        properties: {
                            hexRadius: this.getHexRadius(this.dataView)
                        }
                    };
                    instances.push(size);
                    break;
                case 'displayOptions':
                    var displayOptions: VisualObjectInstance = {
                        objectName: 'displayOptions',
                        displayName: 'Display',
                        selector: null,
                        properties: {
                            showDots: this.getShowDots(this.dataView),
                            showBins: this.getShowBins(this.dataView),
                            showRug: this.getShowRug(this.dataView)
                        }
                    };
                    instances.push(displayOptions);
                    break;
            }

            return instances;
        }

        private getFill(dataView: DataView): Fill {
            if (dataView && dataView.metadata.objects) {
                var color = dataView.metadata.objects['color'];
                if (color) {
                    return <Fill>color['fill'];
                }
            }
            return { solid: { color: 'rgb(1, 184, 170)' } };
        }
        
        private cleanup(){
            //remove/hide elements
            this.mainChart.selectAll(".axis").selectAll(".tick").remove();
            this.mainChart.selectAll(".axis").selectAll(".label").attr("visibility", "hidden");
            this.mainChart.selectAll(".hexagon").remove();
            this.mainChart.selectAll(".dot").remove();
            this.mainChart.selectAll(".x-rug").remove();
            this.mainChart.selectAll(".y-rug").remove();
        }
		
		private addNotification(noteText){
			//add on-screen message to user
			this.mainChart.append("text")
                    .attr("class", "note-text")
                    .attr("x", "50%")
                    .attr("y", "45%")
                    .style("text-anchor", "middle")
                    .text(noteText);
		}

        public destroy() {
            this.svg.remove();
        }

    }
}