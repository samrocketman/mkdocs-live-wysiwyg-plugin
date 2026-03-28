---
title: Creating Diagrams
weight: 300
---
# Mermaid Diagramming Tutorial

You can create mermaid diagrams.  Just inline type ```` ```mermaid ```` and a mermaid diagram will appear.  The following mermaid diagram describes how you inline type to create a diagram starting on an empty paragraph.


## How to create a diagram


```mermaid
stateDiagram-v2
    state "Type triple<br>backticks (```)" as Still
    state "Press<br>BACKSPACE<br>to revert code<br>block insert." as Moving
    state "Typing 'mermaid'<br>with a space<br>completes the diagram" as Crash

    [*] --> Still
    Still --> [*]
    Still --> Moving
    Moving --> Still
    Moving --> Crash
    Crash --> [*]
```

## Try it out

Create an empty paragraph below this line and try to insert your own diagram.  You can maximize the initial diagram to see other samples in the diagram editor.
