import { config } from 'dotenv';
import { retrievalService } from '../services/retrievalService';

config();

async function initializeQdrant() {
    try {
        console.log('🚀 Initializing Qdrant collection...');

        // Create collection if it doesn't exist
        await retrievalService.createCollection();

        // Sample legal documents
        const sampleDocuments = [
            {
                content: "§ 283 Trestného zákona - Neoprávnené prechovávanie omamných a psychotropných látok\n\n(1) Kto neoprávnene prechováva omamnú alebo psychotropnú látku v množstve väčšom ako malé, bude potrestaný odňatím slobody na šesť mesiacov až tri roky alebo peniaľkou.\n\n(2) Odňatím slobody na jeden rok až päť rokov alebo peniaľkou bude páchateľ potrestaný, ak spácha čin uvedený v odseku 1\n\na) v množstve väčšom ako veľké,\nb) ako člen organizovanej skupiny,\nc) na území školy alebo školského zariadenia,\nd) v blízkosti školy alebo školského zariadenia,\ne) v blízkosti miest určených na zábavu mladistvých alebo\nf) v blízkosti miest určených na zábavu mladistvých.",
                metadata: {
                    title: "Trestný zákon - § 283",
                    type: "law",
                    category: "criminal_law",
                    language: "sk"
                }
            },
            {
                content: "Rozsudok Najvyššieho súdu SR č. 5 Tdo 1/2020\n\nV prípade neoprávneného prechovávania omamných látok je potrebné zohľadniť:\n1. Množstvo omamnej látky\n2. Druh omamnej látky\n3. Účel prechovávania\n4. Spôsob získania\n5. Predchádzajúcu trestnú činnosť\n\nZa prechovávanie marihuany v množstve do 10g môže byť uložený trest odňatia slobody do 1 roka alebo peniaľka.",
                metadata: {
                    title: "Rozsudok NS SR 5 Tdo 1/2020",
                    type: "ruling",
                    category: "criminal_law",
                    language: "sk"
                }
            }
        ];

        console.log('📚 Adding sample documents...');
        await retrievalService.addDocuments(sampleDocuments);

        console.log('✅ Qdrant initialization complete!');
    } catch (error) {
        console.error('❌ Error initializing Qdrant:', error);
        process.exit(1);
    }
}

initializeQdrant(); 