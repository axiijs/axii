/* @jsx createElement*/
import {createElement, createRoot} from "@framework";
import "./index.css"
import {ConceptOverview} from "./component/concept/ConceptOverview";


const root = createRoot(document.getElementById('root')!)
root.render(<ConceptOverview />)


