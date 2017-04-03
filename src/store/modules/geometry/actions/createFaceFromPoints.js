import factory from './../factory.js'
import geometryHelpers from './../helpers'
import modelHelpers from './../../models/helpers'

/*
* create a face and associated edges and vertices from an array of points
* associate the face with the space or shading included in the payload
*/
export default function createFaceFromPoints (context, payload) {
    // set of points to translate to vertices when creating the new face
    var points = payload.points.map(p => ({ ...p, X: p.x, Y: p.y }));
    const currentStoryGeometry = context.rootGetters['application/currentStoryGeometry'],
        target = modelHelpers.libraryObjectWithId(context.rootState.models, payload.space ? payload.space.id : payload.shading.id);

    // validation - a face must have at least 3 vertices and area
    if (points.length < 3 || !geometryHelpers.areaOfFace(points)) { return; }

    // target already has an existing face, destroy it and create a new face from the union of the new points and old face if they intersect
    if (target.face_id) {
        points = handleExistingFace(points, currentStoryGeometry, target, context);
    }

    // prevent overlapping faces by erasing existing geometry covered by the points defining the new face
    context.dispatch('eraseSelection', { points: points });

    ////////////////////////////////////////////////// CREATE AND SAVE GEOMETRY FOR THE FACE //////////////////////////////////////////////////
    // build an array of vertices for the face being created, setting the same ID for points with the same coordinates to prevent overlapping vertices
    const faceVertices = points.map((point) => {
        // if a point was snapped to an existing vertex during drawing, it will have a vertex id
        var vertex = point.id && geometryHelpers.vertexForId(point.id, currentStoryGeometry);
        // reuse the existing vertex or create a new one
        if (!vertex) {
            vertex = new factory.Vertex(point.x, point.y);
            // merge vertices with the same coordinates
            points.filter(p => p !== point && p.x === vertex.x && p.y === vertex.y)
                .forEach((mergePoint) => { mergePoint.id = vertex.id; });

            context.commit('createVertex', {
                vertex: vertex,
                geometry: currentStoryGeometry
            });
        }
        return vertex;
    });

    // build an array of edges for the face based on the set of vertices
    const faceEdges = faceVertices.map((v1, i) => {
        // v2 is the first vertex in the array when the face is being closed
        const v2 = i + 1 < faceVertices.length ? faceVertices[i + 1] : faceVertices[0];
        // check if an edge referencing the two vertices already exists
        var sharedEdge = currentStoryGeometry.edges.find((e) => {
            return (e.v1 === v1.id && e.v2 === v2.id) || (e.v2 === v1.id && e.v1 === v2.id);
        });

        if (sharedEdge) {
            // if a shared edge exists, check if its direction matches the edge direction required for the face being created
            sharedEdge = JSON.parse(JSON.stringify(sharedEdge));
            sharedEdge.reverse = (sharedEdge.v1 !== v1.id);
            return sharedEdge;
        } else {
            // create and store a new edge with the vertices
            const edge = new factory.Edge(v1.id, v2.id);
            context.commit('createEdge', {
                edge: edge,
                geometry: currentStoryGeometry
            });
            return edge;
        }
    });

    // create a new face object with references to the edges
    const face = new factory.Face(faceEdges.map(e => ({
        edge_id: e.id,
        reverse: e.reverse
    })));

    var validFace = true;
    /*
    * Validate the new face against self intersection by checking for:
    * folded (duplicate geometry) edges referencing the same two endpoints on the same face
    * vertex on the face splitting an edge on the face
    * vertex on the face snapped to another vertex on the face
    * TODO: prevent crossing edges on the same face
    */
    for (var i = 0; i < faceEdges.length; i++) {
        const edge = faceEdges[i];

        // vertices on the face being created
        const verticesForFace = geometryHelpers.verticesForFace(face, currentStoryGeometry),
            // saved vertices which are touching the edge (excluding the edge's endpoints)
            splittingVertices = geometryHelpers.verticesOnEdge(edge, currentStoryGeometry)

        // if a vertex on the face touches an edge on the face, then the face is self intersecting and invalid
        for (var j = 0; j < splittingVertices.length; j++) {
            const vertex = splittingVertices[j];
            if (verticesForFace.indexOf(vertex) !== -1) {
                validFace = false;
            }
        }

        // if more than one vertex on the face has a single id, the face has snapped to itself and is self intersecting
        for (var j = 0; j < verticesForFace.length; j++) {
            const vertex = verticesForFace[j];
            if (verticesForFace.filter(v => v.id === vertex.id).length >= 2) {
                validFace = false;
            }
        }

        // // if two edges on the same face reference the same two vertices, the face is invalid
        // faceEdges.forEach((e) => {
        //     // don't compare an edge to itself
        //     if (e.id === edge.id) { return; }
        //     // found another edge with the same v1 and v2 on the face being created
        //     if ((e.v1 === edge.v1 && e.v2 === edge.v2) || (e.v2 === edge.v1 && e.v1 === edge.v2)) {
        //         validFace = false;
        //     }
        // });
    }

    // save the face if it is valid, otherwise abort and destroy the edges and vertices created earlier to prevent an invalid state
    if (validFace) {
        context.commit('createFace', {
            face: face,
            geometry: currentStoryGeometry
        });

        context.dispatch(target.type === 'space' ? 'models/updateSpaceWithData' : 'models/updateShadingWithData', {
            [target.type]: target,
            face_id: face.id
        }, { root: true });
    } else {
        // dispatch destroyFaceAndDescendents to destroy edges and vertices created for the invalid face
        context.dispatch('destroyFaceAndDescendents', {
            geometry: currentStoryGeometry,
            face: face
        });
        return;
    }





    function splittingVertices () {
        var ct = 0;
        currentStoryGeometry.edges.forEach((edge) => {
            ct += geometryHelpers.verticesOnEdge(edge, currentStoryGeometry).length;
        });
        return ct;
    }
    var splitcount = splittingVertices();
    // TODO: fix infinite loop on self intersecting polygon shapes
    while (splitcount) {
        // loop through all edges and divide them at any non endpoint vertices they contain
        currentStoryGeometry.edges.forEach((edge) => {
            // vertices dividing the current edge
            geometryHelpers.verticesOnEdge(edge, currentStoryGeometry).forEach((splittingVertex) => {
                context.dispatch('splitEdge', {
                    vertex: splittingVertex,
                    edge: edge
                });
            });
        });
        splitcount = splittingVertices();
    }

    // if the faces which were originally snapped to still exist, normalize their edges
    currentStoryGeometry.faces.forEach((affectedFace) => {
        const normalizeEdges = geometryHelpers.normalizedEdges(affectedFace, currentStoryGeometry);
        context.commit('setEdgeRefsForFace', {
            face: affectedFace,
            edgeRefs: normalizeEdges
        });
    });
};

/*
* destroy the existing face on the target
* if the new face intersects the existing face or shares an edge with the existing face,
* update the points used to create the new face to be the UNION of the new and existing faces
*/
function handleExistingFace (points, currentStoryGeometry, target, context) {
    const existingFace = geometryHelpers.faceForId(target.face_id, currentStoryGeometry),
        existingFaceVertices = geometryHelpers.verticesForFace(existingFace, currentStoryGeometry);

    /*
    * check if new and existing face share an edge
    * loop through all points for the new face and check if they are splitting an edge which belongs to the existing face
    */
    for (var i = 0; i < points.length; i++) {
        const splitEdge = points[i].splittingEdge;
        if (splitEdge && ~existingFace.edgeRefs.map(e => e.edge_id).indexOf(splitEdge.id)) {
            console.log("do union, point splits edge", existingFace.edgeRefs[existingFace.edgeRefs.map(e => e.edge_id).indexOf(splitEdge.id)]);
            // new and existing face share an edge - update points to use their union
            points = geometryHelpers.unionOfFaces(existingFaceVertices, points, currentStoryGeometry);
        }
    }

    // check if new and existing face intersect
    if (geometryHelpers.intersectionOfFaces(existingFaceVertices, points, currentStoryGeometry)) {
        points = geometryHelpers.unionOfFaces(existingFaceVertices, points, currentStoryGeometry);
    }

    // destroy the existing face and remove references to it
    context.dispatch(target.type === 'space' ? 'models/updateSpaceWithData' : 'models/updateShadingWithData', {
        [target.type]: target,
        face_id: null
    }, { root: true });

    context.dispatch('destroyFaceAndDescendents', {
        geometry: currentStoryGeometry,
        face: existingFace
    });

    return points;
}