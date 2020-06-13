import { describe } from 'mocha'
import { assert } from 'chai';
import {CIMBindingsPlugin} from "../../main/bindings/CIMBindingsPlugin";
import * as fs from 'fs';
import * as process from 'process'

describe('CIMBindingsPlugins', function() {
    this.timeout(5000);
    it('should parse CIM distribution and generate subject areas', async function () {
        const cimPlugin = new CIMBindingsPlugin();
        const textUrl = "src/test/resources/model.jsonld";
        const textData = fs.readFileSync(textUrl).toString();
        const parsed = await cimPlugin.import([{ url: "file://"+ textUrl, text: textData}] );

        assert.equal(parsed.length, 14);
        assert.equal(parsed[0].declarations.length, 18);
        assert(parsed[0].encodes != null);
        assert(parsed != null);
    });

});