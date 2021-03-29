import * as n3 from "n3";
import {JsonLdParser} from "jsonld-streaming-parser";

export const $rdf = n3.DataFactory;
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

export function store(): n3.Store {
    // @ts-ignore
    return $rdf.graph();
}

export function loadGraph(str: string, existingStore?: n3.Store): Promise<n3.Store> {
   return new Promise((resolve, reject) => {
        // @ts-ignore
        const store: n3.N3Store = existingStore || $rdf.graph();

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

/**
 * Finds a particular object for a subject and property path in the N3 store
 * @param store
 * @param subject
 * @param path
 */
export function findPath(store: n3.Store, subject: n3.Quad_Object, path: n3.Quad_Object[]): n3.Quad_Object|null {
    const next = path.shift()!;
    const nextSubject = store.getObjects(subject, next, null)[0];
    if (nextSubject) {
        if (path.length === 0) {
            return nextSubject;
        } else {
            return findPath(store, nextSubject, path);
        }
    } else {
        return null;
    }
}