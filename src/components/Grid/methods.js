// OpenStudio(R), Copyright (c) 2008-2016, Alliance for Sustainable Energy, LLC. All rights reserved.
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
// (1) Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
// (2) Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
// (3) Neither the name of the copyright holder nor the names of any contributors may be used to endorse or promote products derived from this software without specific prior written permission from the respective party.
// (4) Other than as required in clauses (1) and (2), distributions in any form of modifications or other derivative works may not use the "OpenStudio" trademark, "OS", "os", or any other confusingly similar designation without specific prior written permission from Alliance for Sustainable Energy, LLC.
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER, THE UNITED STATES GOVERNMENT, OR ANY CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const d3 = require('d3');
import geometryHelpers from './../../store/modules/geometry/helpers.js'
import modelHelpers from './../../store/modules/models/helpers.js'

export default {
    // ****************** USER INTERACTION EVENTS ****************** //
    /*
    * handle a click on the svg grid
    */
    gridClicked (e) {
        if (this.currentTool === 'Select') {
            this.$store.dispatch('application/setCurrentSpace', { 'space': null });
            this.$store.dispatch('application/setCurrentShading', { 'shading': null });
        } else if (this.currentTool === 'Eraser' ||
            ((this.currentTool === 'Rectangle' || this.currentTool === 'Polygon') && (this.currentSpace || this.currentShading))) {
            this.addPoint(e);
        }
    },

    /*
    * If the grid is clicked when a drawing tool or the eraser tool is active, add a point to the component
    * if the new point completes a face being drawn, save the face
    * if the new point completes an eraser selection, call the eraseRectangularSelection method
    */
    addPoint (e) {
        // location of the mouse in grid units
        const gridPoint = {
                x: this.pxToGrid(e.offsetX, 'x'),
                y: this.pxToGrid(e.offsetY, 'y')
            },
            snapTarget = this.findSnapTarget(gridPoint);

        // if the snapTarget is the origin of the face being drawn in Polygon mode, close the face and don't add a new point
        if (snapTarget.type === 'vertex' && snapTarget.origin && this.currentTool === 'Polygon') {
            this.savePolygonFace();
            return;
        }

        // create the point
        var newPoint = snapTarget.type === 'edge' ? snapTarget.projection : snapTarget;
        this.points.push(newPoint);

        // if the Rectangle or Eraser tool is active and two points have been drawn (to define a rectangle)
        // complete the corresponding operation for the tool
        if (this.currentTool === 'Eraser' && this.points.length === 2) { this.eraseRectangularSelection(); }
        if (this.currentTool === 'Rectangle' && this.points.length === 2) { this.saveRectuangularFace(); }
    },

    /*
    * When a mousemove event is triggered on the grid and
    * the 'Rectangle' or 'Polygon' tool is active and a space or shading is selected or the 'Eraser' tool is active
    * look up the snap target for the location of the event, highlight it, and render a guide point
    * if there is no snap target, use the event location
    */
    highlightSnapTarget (e) {
        // only highlight snap targets in drawing modes when a space or shading has been selected
        if (this.currentTool !== 'Eraser' && ((this.currentTool !== 'Rectangle' && this.currentTool !== 'Polygon') || (!this.currentSpace && !this.currentShading))) { return; }

        // unhighlight expired snap targets
        d3.selectAll('#grid .highlight, #grid .gridpoint').remove();

        // location of the mouse in grid units
        const gridPoint = {
            x: this.pxToGrid(e.offsetX, 'x'),
            y: this.pxToGrid(e.offsetY, 'y')
        };

        const snapTarget = this.findSnapTarget(gridPoint);

        // render a line and point showing which geometry would be created with a click at this location
        var guidePoint = snapTarget.type === 'edge' ? snapTarget.projection : snapTarget;
        this.drawGuideLines(e, guidePoint);

        // if snapping to an edisting edge or radius, draw a larger point, if snapping to the grid or just displaying the location of the pointer, create a small point
        if (snapTarget.type === 'edge' || snapTarget.type === 'vertex') {
            d3.select('#grid svg')
                .append('ellipse')
                .attr('cx', guidePoint.x, 'x')
                .attr('cy', guidePoint.y, 'y')
                .attr('rx', this.scaleX(5))
                .attr('ry', this.scaleY(5))
                .classed('highlight', true)
                .attr('vector-effect', 'non-scaling-stroke');
        } else {
            d3.select('#grid svg')
                .append('ellipse')
                .attr('cx', guidePoint.x)
                .attr('cy', guidePoint.y)
                .attr('rx', this.scaleX(2))
                .attr('ry', this.scaleY(2))
                .classed('gridpoint', true)
                .attr('vector-effect', 'non-scaling-stroke');
        }

        // in drawing modes, highlight edges that would be snapped to
        if (snapTarget.type === 'edge' && this.currentTool !== 'Eraser') {
            d3.select('#grid svg')
                .append('line')
                .attr('x1', snapTarget.v1GridCoords.x)
                .attr('y1', snapTarget.v1GridCoords.y)
                .attr('x2', snapTarget.v2GridCoords.x)
                .attr('y2', snapTarget.v2GridCoords.y)
                .attr('stroke-width', 1)
                .classed('highlight', true)
                .attr('vector-effect', 'non-scaling-stroke');
        }
    },

    /*
    * called on mousemove events, shows the user what geometry will be created by clicking at the current mouse location by
    * drawing a guide rectangle or a guideline between the last point drawn and the guidepoint
    */
    drawGuideLines (e, guidePoint) {
        if (!this.points.length) { return; }

        // remove expired guideline paths
        d3.selectAll('#grid .guideline').remove();

        var guidelinePoints;

        // if the polygon tool is active, draw a line connecting the last point in the polygon to the guide point
        // if the rectangle or eraser tool is active, infer a rectangle from the first point that was drawn and the guide point
        if (this.currentTool === 'Polygon') {
            guidelinePoints = [guidePoint, this.points[this.points.length - 1]];
        } else if (this.currentTool === 'Rectangle' || this.currentTool === 'Eraser') {
            guidelinePoints = [
                this.points[0],
                { x: guidePoint.x, y: this.points[0].y },
                guidePoint,
                { x: this.points[0].x, y: guidePoint.y },
                this.points[0]
            ];
        }

        // render a guideline or rectangle
        d3.select('#grid svg').append('path')
            .datum(guidelinePoints)
            .attr('fill', 'none')
            .classed('guideline', true)
            .attr('vector-effect', 'non-scaling-stroke')
            .attr('d', d3.line()
                .x((d) => { return d.x; })
                .y((d) => { return d.y; }))
            .lower();

        d3.selectAll('.vertical, .horizontal').lower();
    },

    // ****************** SAVING FACES ****************** //
    /*
    * The origin of the polygon being drawn was clicked, create a polygon face from all points on the grid
    * translate the points into RWU and save the face for the selected space or shading
    */
    savePolygonFace () {
        const payload = {
            // translate grid points from grid units to RWU
            points: this.points.map(p => ({
                x: this.gridToRWU(p.x, 'x'),
                y: this.gridToRWU(p.y, 'y')
            }))
        };

        if (this.currentSpace) {
            payload.space = this.currentSpace;
        } else if (this.currentShading) {
            payload.shading = this.currentShading;
        }

        this.$store.dispatch('geometry/createFaceFromPoints', payload);

        // clear points from the grid
        this.points = [];
    },

    /*
    * create a rectangular face from the two points on the grid
    * save the rectangle as a face for the selected space or shading
    */
    saveRectuangularFace () {
        // infer 4 corners of the rectangle based on the two points that have been drawn
        const payload = {
            points: [
                this.points[0],
                { x: this.points[1].x, y: this.points[0].y },
                this.points[1],
                { x: this.points[0].x, y: this.points[1].y }
            ]
        };

        // translate points from grid units to RWU
        payload.points = payload.points.map(p => ({
            x: this.gridToRWU(p.x, 'x'),
            y: this.gridToRWU(p.y, 'y')
        }));

        if (this.currentSpace) {
            payload.space = this.currentSpace;
        } else if (this.currentShading) {
            payload.shading = this.currentShading;
        }

        this.$store.dispatch('geometry/createFaceFromPoints', payload);

        // clear points from the grid
        this.points = [];
    },

    // ****************** ERASING FACES ****************** //
    /*
    * called when 2 points have been created on the grid and the eraser tool is active
    * infer a rectangular eraser selection based on two points on the grid
    * remove the intersection of all geometry on the current story with the eraser selection
    */
    eraseRectangularSelection () {
        // infer 4 corners of the rectangle based on the two points that have been drawn
        const payload = {
            points: [
                this.points[0],
                { x: this.points[1].x, y: this.points[0].y },
                this.points[1],
                { x: this.points[0].x, y: this.points[1].y }
            ]
        };

        // translate points from grid units to RWU
        payload.points = payload.points.map(p => ({
            x: this.gridToRWU(p.x, 'x'),
            y: this.gridToRWU(p.y, 'y')
        }));

        this.$store.dispatch('geometry/eraseSelection', payload);

        // clear points from the grid
        this.points = [];
    },


    // ****************** d3 RENDERING ****************** //
    /*
    * render points for the face being drawn, connect them with a guideline
    */
    drawPoints () {
        // remove expired points and guidelines
        d3.selectAll('#grid ellipse, #grid path').remove();

        // draw points
        d3.select('#grid svg')
            .selectAll('ellipse').data(this.points)
            .enter().append('ellipse')
            .attr('cx', d => d.x)
            .attr('cy', d => d.y)
            .attr('rx', this.scaleX(2))
            .attr('ry', this.scaleY(2))
            .attr('vector-effect', 'non-scaling-stroke');

        // apply custom CSS for origin of polygons
        d3.select('#grid svg').select('ellipse')
            .attr('rx', this.scaleX(7))
            .attr('ry', this.scaleY(7))
            .classed('origin', true)
            .attr('vector-effect', 'non-scaling-stroke')
            .attr('fill', 'none');

        // connect the points for the face being drawn with a line
        d3.select('#grid svg').append('path')
            .datum(this.points)
            .attr('fill', 'none')
            .attr('vector-effect', 'non-scaling-stroke')
            .attr('d', d3.line().x(d => d.x).y(d => d.y))
            // prevent edges from overlapping points - interferes with click events
            .lower();

        // keep grid lines under polygon edges
        d3.selectAll('.vertical, .horizontal').lower();
    },

    /*
    * render saved faces as polygons
    * handle clicks to select faces
    */
    drawPolygons () {
        // remove expired polygons
        d3.select('#grid svg').selectAll('polygon').remove();

        // draw polygons
        d3.select('#grid svg').selectAll('polygon')
            .data(this.polygons).enter()
            .append('polygon')
            // if a face is clicked while the Select tool is active, lookup its corresponding model (space/shading) and select it
            .on('click', (d) => {
                if (this.currentTool === 'Select') {
                    d3.event.stopPropagation();
                    const model = modelHelpers.modelForFace(this.$store.state.models, d.face_id);
                    if (model.type === 'space') {
                        this.$store.dispatch('application/setCurrentSpace', { 'space': model });
                    } else if (model.type === 'shading') {
                        this.$store.dispatch('application/setCurrentShading', { 'shading': model });
                    }
                }
            })
            .attr("points", d => d.points.map(p => [this.rwuToGrid(p.x, 'x'), this.rwuToGrid(p.y, 'y')].join(",")).join(" "))
            .attr('class', (d, i) => {
                if ((this.currentSpace && d.face_id === this.currentSpace.face_id) ||
                    (this.currentShading && d.face_id === this.currentShading.face_id)) { return 'current'; }
                if (d.previous_story) { return 'previousStory'}
            })
            .attr('fill', d => d.color)
            .attr('vector-effect', 'non-scaling-stroke');

        // render the selected model's face above the other polygons so that the border is not obscured
        d3.select('.current').raise();
    },

    // ****************** SNAPPING TO EXISTING GEOMETRY ****************** //
    /*
    * given a point in grid units, find the closest vertex or edge within its snap tolerance
    * if the grid is active and no vertex or edge is within the snap tolerance, returns the closest grid point
    * if the grid is inactive, returns the or the location of the point
    */
    findSnapTarget (gridPoint) {
        // translate grid point to real world units to check for snapping targets
        const rwuPoint = {
            x: this.gridToRWU(gridPoint.x, 'x'),
            y: this.gridToRWU(gridPoint.y, 'y')
        };

        // if a snappable vertex exists, don't check for edges
        const snappingVertex = this.snappingVertexData(rwuPoint);
        if (snappingVertex) { return snappingVertex; }

        const snappingEdge = this.snappingEdgeData(rwuPoint);
        if (snappingEdge) { return snappingEdge; }

        // grid is active and no vertices or edges are within snapping range, calculate the closest grid point to snap to
        if (this.gridVisible) {
            // offset of the first gridline on each axis
            const xOffset = +this.axis.x.select('.tick').attr('transform').replace('translate(', '').replace(')', '').split(',')[0],
                yOffset = +this.axis.y.select('.tick').attr('transform').replace('translate(', '').replace(')', '').split(',')[1],

                // spacing between ticks in grid units
                xTickSpacing = this.rwuToGrid(this.spacing + this.min_x, 'x'),
                yTickSpacing = this.rwuToGrid(this.spacing + this.min_y, 'y');

            // round point RWU coordinates to nearest gridline, adjust by grid offset
            const snapTarget = {
                type: 'gridpoint',
                x: this.round(gridPoint.x, this.rwuToGrid(this.spacing + this.min_x, 'x')) + xOffset,
                y: this.round(gridPoint.y, this.rwuToGrid(this.spacing + this.min_y, 'y')) + yOffset
            };

            // pick closest point
            snapTarget.x = Math.abs(gridPoint.x - (snapTarget.x - xTickSpacing)) > Math.abs(gridPoint.x - snapTarget.x) ? snapTarget.x : snapTarget.x - xTickSpacing;
            snapTarget.y = Math.abs(gridPoint.y - (snapTarget.y - yTickSpacing)) > Math.abs(gridPoint.y - snapTarget.y) ? snapTarget.y : snapTarget.y - yTickSpacing;

            return snapTarget;
        }

        // nothing to snap to, just return the locatio of the point
        return {
            type: 'gridpoint',
            ...gridPoint
        };
    },

    /*
    * given a point in RWU, look up the closest snappable vertex
    * if the vertex is within the snap tolerance of the point, return the coordinates of the vertex in grid units
    * and the distance from the vertex to the point
    */
    snappingVertexData (point) {
        // build a list of vertices (in RWU) available for snapping
        // deep copy all vertices on the current story
        var snappableVertices =  [...this.currentStoryGeometry.vertices];

        // TODO: conditionally combine this list with vertices from the next story down if it is visible
        if (this.previousStoryGeometry) {
            snappableVertices = snappableVertices.concat(JSON.parse(JSON.stringify(this.previousStoryGeometry.vertices)));
        }

        // if the polygon tool is active and the polygon being drawn has at least 3 existing points allow snapping to the origin of the polygon
        if (this.points.length >= 3 && this.currentTool === 'Polygon') {
            // convert the polygon origin from grid units to real world units before adding it as a snappable vertex
            snappableVertices.push({
                x: this.gridToRWU(this.points[0].x, 'x'),
                y: this.gridToRWU(this.points[0].y, 'y'),
                origin: true // set a flag to mark the origin
            });
        }

        if (!snappableVertices.length) { return; }

        // find the vertex closest to the point being tested
        const nearestVertex = snappableVertices.reduce((a, b) => {
            const aDist = this.distanceBetweenPoints(a, point),
                bDist = this.distanceBetweenPoints(b, point);
            return aDist < bDist ? a : b;
        });

        // return the nearest vertex if it is within the snap tolerance of the point
        if (this.distanceBetweenPoints(nearestVertex, point) < this.$store.getters['project/snapTolerance']) {
            return {
                x: this.rwuToGrid(nearestVertex.x, 'x'),
                y: this.rwuToGrid(nearestVertex.y, 'y'),
                origin: nearestVertex.origin,
                type: 'vertex'
            };
        }
    },

    /*
    * given a point in RWU, look up the closest snappable edge
    * if the projection of the point to the edge is within the snap tolerance of the point, return the edge and coordinates of the projection in grid units
    * and the distance from the projection to the point
    */
    snappingEdgeData (point) {
        // build a list of edges (in RWU) available for snapping
        // deep copy all vertices on the current story
        var snappableEdges = [...this.currentStoryGeometry.edges];

        // TODO: conditionally combine this list with edges from the next story down if it is visible
        if (this.previousStoryGeometry) {
            snappableEdges = snappableEdges.concat(JSON.parse(JSON.stringify(this.previousStoryGeometry.edges.map(e => ({
                ...e,
                previous_story: true
            })))));
        }

        if (!snappableEdges.length) { return; }

        // find the edge closest to the point being tested
        const nearestEdge = snappableEdges.reduce((a, b) => {
            const aStoryGeometry = a.previous_story ? this.previousStoryGeometry : this.currentStoryGeometry,
                bStoryGeometry = b.previous_story ? this.previousStoryGeometry : this.currentStoryGeometry,
                // look up vertices associated with edges
                aV1 = geometryHelpers.vertexForId(a.v1, aStoryGeometry),
                aV2 = geometryHelpers.vertexForId(a.v2, aStoryGeometry),

                bV1 = geometryHelpers.vertexForId(b.v1, bStoryGeometry),
                bV2 = geometryHelpers.vertexForId(b.v2, bStoryGeometry),

                // project point being tested to each edge
                aProjection = geometryHelpers.projectToEdge(point, aV1, aV2).projection,
                bProjection = geometryHelpers.projectToEdge(point, bV1, bV2).projection,

                // look up distance between projection and point being tested
                aDist = this.distanceBetweenPoints(aProjection, point),
                bDist = this.distanceBetweenPoints(bProjection, point);

            // return data for the edge with the closest projection to the point being tested
            return aDist < bDist ? a : b;
        });

        // look up vertices associated with nearest edge
        const nearestEdgeStoryGeometry = nearestEdge.previous_story ? this.previousStoryGeometry : this.currentStoryGeometry,
            nearestEdgeV1 = geometryHelpers.vertexForId(nearestEdge.v1, nearestEdgeStoryGeometry),
            nearestEdgeV2 = geometryHelpers.vertexForId(nearestEdge.v2, nearestEdgeStoryGeometry),

            // project point being tested to nearest edge
            projection = geometryHelpers.projectToEdge(point, nearestEdgeV1, nearestEdgeV2).projection,

            // look up distance between projection and point being tested
            dist = this.distanceBetweenPoints(projection, point);

        // return data for the edge if the projection is within the snap tolerance of the point
        if (dist < this.$store.getters['project/snapTolerance']) {
            return {
                snappingEdge: nearestEdge,
                dist: nearestEdge.dist,
                type: 'edge',
                // projection and snapping edge vertices translated into grid coordinates (to display snapping point and highlight edges)
                projection: { x: this.rwuToGrid(projection.x, 'x'), y: this.rwuToGrid(projection.y, 'y') },
                v1GridCoords: { x: this.rwuToGrid(nearestEdgeV1.x, 'x'), y: this.rwuToGrid(nearestEdgeV1.y, 'y') },
                v2GridCoords: { x: this.rwuToGrid(nearestEdgeV2.x, 'x'), y: this.rwuToGrid(nearestEdgeV2.y, 'y') }
            }
        }
    },

    // ****************** SNAPPING HELPERS ****************** //
    /*
    * returns the distance between two points
    */
    distanceBetweenPoints (p1, p2) {
        const dx = Math.abs(p1.x - p2.x),
            dy = Math.abs(p1.y - p2.y);
        return Math.sqrt((dx * dx) + (dy * dy));
    },

    /*
    * round a number n to the nearest x
    */
    round (n, x) {
        var result,
            sign = n < 0 ? -1 : 1;
        n = Math.abs(n);
        if (n % x < x / 2) {
            result = n - (n % x);
        } else {
            result = n + x - (n % x);
        }
        // handle negatives
        return result *= sign;
    },

    /*
    * If the min_x, max_x, min_y, max_y are changed by some non zoom event (like window resize or model import)
    * like a window resize or a data import adjust the zoom identity
    */
    reloadGrid (dx, dy, dz) {
        d3.select('#grid svg')
            .call(this.zoomBehavior.transform, () => {
                // the zoom identity scale is calculated from original_bounds,
                // so we can infer a new zoom identity by taking the ratio between the original x range and new x range
                d3.zoomIdentity.k = (this.original_bounds.max_x - this.original_bounds.min_x) / (this.max_x - this.min_x);
                d3.zoomIdentity.x = -this.min_x * d3.zoomIdentity.k;
                d3.zoomIdentity.y = -this.min_y * d3.zoomIdentity.k;

                d3.select('#grid svg').call(this.zoomBehavior.transform, d3.zoomIdentity);
                return d3.zoomIdentity;
            });
    },

    // ****************** GRID ****************** //
    calcGrid () {
        // set viewbox on svg in rwu so drawing coordinates are in rwu and not pixels
        this.$refs.grid.setAttribute('viewBox', `0 0 ${this.max_x - this.min_x} ${this.max_y - this.min_y}`);

        // scaleX amd scaleY are used during drawing to translate from px to RWU given the current grid dimensions in rwu
        // these are initialized here and never changed
        this.$store.dispatch('application/setScaleX', {
            scaleX: d3.scaleLinear()
                .domain([0, this.$refs.grid.clientWidth])
                .range([this.min_x, this.max_x])
        });
        this.$store.dispatch('application/setScaleY', {
            scaleY: d3.scaleLinear()
                .domain([0, this.$refs.grid.clientHeight])
                .range([this.min_y, this.max_y])
        });

        const svg = d3.select('#grid svg'),
            // rwu dimensions (coordinates used within grid)
            rwuHeight = this.max_y - this.min_y,
            rwuWidth = this.max_x - this.min_x,

            // these are essentially unit scales, but they span the full range that each axis should cover instead of just being 1 unit long
            zoomScaleX = d3.scaleLinear()
                .domain([this.min_x, this.max_x])
                .range([this.min_x, this.max_x]),
            zoomScaleY = d3.scaleLinear()
                .domain([this.min_y, this.max_y])
                .range([this.min_y, this.max_y]);

        // generator functions for axes
        this.axis_generator.x = d3.axisBottom(zoomScaleX)
            .ticks(rwuWidth / this.spacing)
            .tickSize(rwuHeight)
            .tickPadding(this.scaleY(-20));
        this.axis_generator.y = d3.axisRight(zoomScaleY)
            .ticks(rwuHeight / this.spacing)
            .tickSize(rwuWidth)
            .tickPadding(this.scaleX(-20));

        this.axis.x = svg.append('g')
            .attr('class', 'axis axis--x')
            .attr('stroke-width', this.scaleY(1))
            .style('display', this.gridVisible ? 'inline' : 'none')
            .call(this.axis_generator.x);
        this.axis.y = svg.append('g')
            .attr('class', 'axis axis--y')
            .attr('stroke-width', this.scaleX(1))
            .style('display', this.gridVisible ? 'inline' : 'none')
            .call(this.axis_generator.y);


        // configure zoom behavior in rwu
        this.zoomBehavior = d3.zoom()
            .on('zoom', () => {

                // only allow zooming when the Pan tool is active
                if (this.currentTool !== "Pan") { return; }

                // create updated copies of the scales based on the zoom transformation
                // the transformed scales are only used to obtain the new rwu grid dimensions and redraw the axes
                // NOTE: don't change the original scale or you'll get exponential growth
                const newScaleX = d3.event.transform.rescaleX(zoomScaleX),
                    newScaleY = d3.event.transform.rescaleY(zoomScaleY);
                    
                [this.min_x, this.max_x] = newScaleX.domain();
                [this.min_y, this.max_y] = newScaleY.domain();

                const scaledRwuHeight = this.max_y - this.min_y,
                    scaledRwuWidth = this.max_x - this.min_x;

                // update the number of ticks to display based on the post zoom real world unit height and width
                this.axis.y.call(this.axis_generator.y.ticks(scaledRwuHeight / this.spacing));
                this.axis.x.call(this.axis_generator.x.ticks(scaledRwuWidth / this.spacing));

                // create transformed copies of the scales and apply them to the axes
                this.axis.x.call(this.axis_generator.x.scale(newScaleX));
                this.axis.y.call(this.axis_generator.y.scale(newScaleY));

                // redraw the saved geometry
                this.drawPolygons();
            });

        svg.call(this.zoomBehavior);
    },
    updateGrid () {
        this.axis.x.style('display', this.gridVisible ? 'inline' : 'none');
        this.axis.y.style('display', this.gridVisible ? 'inline' : 'none');

        const rwuHeight = this.max_y - this.min_y,
            rwuWidth = this.max_x - this.min_x;

        // update the number of ticks to display based on the post zoom real world unit height and width
        this.axis.y.call(this.axis_generator.y.ticks(rwuHeight / this.spacing));
        this.axis.x.call(this.axis_generator.x.ticks(rwuWidth / this.spacing));
    },

    // ****************** SCALING FUNCTIONS ****************** //
    /*
    * take a pixel value (from a mouse event), find the corresponding real world units (for snapping to saved geometry in RWU)
    */
    pxToRWU (px, axis) {
        if (axis === 'x') {
            // TODO: computed property for current scales?
            const currentScaleX = d3.scaleLinear()
                    .domain([0, this.$refs.grid.clientWidth])
                    .range([this.min_x, this.max_x]);
            return currentScaleX(px);
        } else if (axis === 'y') {
            const currentScaleY = d3.scaleLinear()
                   .domain([0, this.$refs.grid.clientHeight])
                   .range([this.min_y, this.max_y]);
            return currentScaleY(px);
        }
    },

    /*
    * take a pixel value (from a mouse event), find the corresponding coordinates in the svg grid
    */
    pxToGrid (px, axis) {
        if (axis === 'x') {
            return this.scaleX(px);
        } else if (axis === 'y') {
            return this.scaleY(px);
        }
    },

    /*
    * take a rwu value (from the datastore), find the corresponding coordinates in the svg grid
    */
    rwuToGrid (rwu, axis) {
        if (axis === 'x') {
            const currentScaleX = d3.scaleLinear()
                    .domain([0, this.$refs.grid.clientWidth])
                    .range([this.min_x, this.max_x]),
                pxValue = currentScaleX.invert(rwu);
            return this.pxToGrid(pxValue, axis);
        } else if (axis === 'y') {
            const currentScaleY = d3.scaleLinear()
                   .domain([0, this.$refs.grid.clientHeight])
                   .range([this.min_y, this.max_y]),
                pxValue = currentScaleY.invert(rwu);
            return this.pxToGrid(pxValue, axis);
        }
    },

    /*
    * take a grid value (from some point already rendered to the grid) and translate it into RWU for persistence to the datastore
    */
    gridToRWU (gridValue, axis) {
        if (axis === 'x') {
            const currentScaleX = d3.scaleLinear()
                    .domain([0, this.$refs.grid.clientWidth])
                    .range([this.min_x, this.max_x]),
                pxValue = this.scaleX.invert(gridValue);
            return currentScaleX(pxValue);
        } else if (axis === 'y') {
            const currentScaleY = d3.scaleLinear()
                   .domain([0, this.$refs.grid.clientHeight])
                   .range([this.min_y, this.max_y]),
                pxValue = this.scaleY.invert(gridValue);
            return currentScaleY(pxValue);
        }
    }
}
