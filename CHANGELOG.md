## 0.19.0 (2017-03-16)

### New features

You can now use strings (as well as numbers) as client IDs (this already worked, but now the documentation reflects this).

## 0.18.0 (2017-02-24)

### New features

[`sendableSteps`](http://prosemirror.net/docs/ref/version/0.18.0.html#collab.sendableSteps) now also returns information about the original transactions that produced the steps.

## 0.11.0 (2016-09-21)

### Breaking changes

Moved into a separate module.

Interface [adjusted](http://prosemirror.net/docs/ref/version/0.11.0.html#collab) to work with the new
[plugin](http://prosemirror.net/docs/ref/version/0.11.0.html#state.Plugin) system.

### New features

When receiving changes, the module now
[generates](http://prosemirror.net/docs/ref/version/0.11.0.html#collab.receiveAction) a regular
[transform action](http://prosemirror.net/docs/ref/version/0.11.0.html#state.TransformAction) instead of hard-setting
the editor's document. This solves problematic corner cases for code
keeping track of the document by listening to transform actions.

