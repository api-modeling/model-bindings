import * as n3 from "n3";
import {JsonLdParser} from "jsonld-streaming-parser";


var $rdf = n3.DataFactory;
// @ts-ignore
$rdf.parse = function(data, store, namedGraph, mediaType, cb) {
    const parser = new n3.Parser({format: mediaType});
    parser.parse(data, function(error, quad, prefixes) {
        if (error) {
            cb(error)
        } else if (quad) {
            store.addQuad(quad.subject, quad.predicate, quad.object, $rdf.namedNode(namedGraph))
        } else {
            cb(null, store);
        }
    })
};
// @ts-ignore
$rdf.graph = function() {
    const store = new n3.Store();

    // @ts-ignore
    store.add = function(s,p,o) {
        store.addQuad(s, p, o);
    };

    // @ts-ignore
    store.toNT = function(cb) {
        const writer = new n3.Writer({ format: 'application/n-quads' });
        // @ts-ignore
        store.forEach(function(quad) {
            writer.addQuad(quad.subject, quad.predicate, quad.object);
        });
        writer.end(cb)
    };


    return store;
};


export function loadGraph(str: string): Promise<n3.N3Store> {
   return new Promise((resolve, reject) => {
        // @ts-ignore
        const store: n3.N3Store = $rdf.graph();

        const myParser = new JsonLdParser({
            dataFactory: $rdf
        });
        myParser
            .on('data', (q) => {
                store.addQuad(q);
            })
            .on('error', reject)
            .on('end', () => {
                resolve(store)
            });
        myParser.write(str);
        myParser.end();
    });
}