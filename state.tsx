/* @jsx createElement*/
import {createElement, createRoot} from "@framework";
import "./index.css"
import {StateMachine} from "./component/stateMachine/StateMachine";


const root = createRoot(document.getElementById('root')!)
root.render(<div>
    <h1>test</h1>
    <StateMachine />
</div>)


