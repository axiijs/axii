import { appendFile } from 'fs/promises'
import path from 'path'
const contentToAppend = `
declare global {
    namespace JSX {
        interface IntrinsicElements {
            [name: string]: any
        }
        interface Element extends  ComponentNode {}
    }
}
`;

const filePath = path.join(process.cwd(), 'dist/axii.d.ts');

await appendFile(filePath, contentToAppend)
console.log('global Content successfully appended to file');
