const {EditorState, Selection} = require("prosemirror-state")
const {history, undo, redo, closeHistory} = require("prosemirror-history")
const {schema, eq, doc, p} = require("prosemirror-test-builder")
const ist = require("ist")

const {collab, receiveTransaction, sendableSteps} = require("..")

const histPlugin = history()

class DummyServer {
  constructor(doc, n = 2) {
    this.states = []
    this.plugins = []
    for (let i = 0; i < n; i++) {
      let plugin = collab()
      this.plugins.push(plugin)
      this.states.push(EditorState.create({doc, schema, plugins: [histPlugin, plugin]}))
    }
    this.steps = []
    this.clientIDs = []
    this.delayed = []
  }

  sync(n) {
    let state = this.states[n], version = this.plugins[n].getState(state).version
    if (version != this.steps.length)
      this.states[n] = state.apply(receiveTransaction(state, this.steps.slice(version), this.clientIDs.slice(version)))
  }

  send(n) {
    let sendable = sendableSteps(this.states[n])
    if (sendable && sendable.version == this.steps.length) {
      this.steps = this.steps.concat(sendable.steps)
      for (let i = 0; i < sendable.steps.length; i++) this.clientIDs.push(sendable.clientID)
    }
  }

  broadcast(n) {
    if (this.delayed.indexOf(n) > -1) return
    this.sync(n)
    this.send(n)
    for (let i = 0; i < this.states.length; i++) if (i != n) this.sync(i)
  }

  update(n, f) {
    this.states[n] = this.states[n].apply(f(this.states[n]))
    this.broadcast(n)
  }

  type(n, text, pos) {
    this.update(n, s => s.tr.insertText(text, pos || s.selection.head))
  }

  undo(n) {
    undo(this.states[n], tr => this.update(n, () => tr))
  }

  redo(n) {
    redo(this.states[n], tr => this.update(n, () => tr))
  }

  conv(d) {
    if (typeof d == "string") d = doc(p(d))
    this.states.forEach(state => ist(state.doc, d, eq))
  }

  delay(n, f) {
    this.delayed.push(n)
    f()
    this.delayed.pop()
    this.broadcast(n)
  }
}

function sel(near) {
  return s => s.tr.setSelection(Selection.near(s.doc.resolve(near)))
}

describe("collab", () => {
  it("converges for simple changes", () => {
    let s = new DummyServer
    s.type(0, "hi")
    s.type(1, "ok", 3)
    s.type(0, "!", 5)
    s.type(1, "...", 1)
    s.conv("...hiok!")
  })

  it("converges for multiple local changes", () => {
    let s = new DummyServer
    s.type(0, "hi")
    s.delay(0, () => {
      s.type(0, "A")
      s.type(1, "X")
      s.type(0, "B")
      s.type(1, "Y")
    })
    s.conv("hiXYAB")
  })

  it("converges with three peers", () => {
    let s = new DummyServer(null, 3)
    s.type(0, "A")
    s.type(1, "U")
    s.type(2, "X")
    s.type(0, "B")
    s.type(1, "V")
    s.type(2, "C")
    s.conv("AUXBVC")
  })

  it("converges with three peers with multiple steps", () => {
    let s = new DummyServer(null, 3)
    s.type(0, "A")
    s.delay(1, () => {
      s.type(1, "U")
      s.type(2, "X")
      s.type(0, "B")
      s.type(1, "V")
      s.type(2, "C")
    })
    s.conv("AXBCUV")
  })

  it("supports undo", () => {
    let s = new DummyServer
    s.type(0, "A")
    s.type(1, "B")
    s.type(0, "C")
    s.undo(1)
    s.conv("AC")
    s.type(1, "D")
    s.type(0, "E")
    s.conv("ACDE")
  })

  it("supports redo", () => {
    let s = new DummyServer
    s.type(0, "A")
    s.type(1, "B")
    s.type(0, "C")
    s.undo(1)
    s.redo(1)
    s.type(1, "D")
    s.type(0, "E")
    s.conv("ABCDE")
  })

  it("supports deep undo", () => {
    let s = new DummyServer(doc(p("hello"), p("bye")))
    s.update(0, sel(6))
    s.update(1, sel(11))
    s.type(0, "!")
    s.type(1, "!")
    s.update(0, s => closeHistory(s.tr))
    s.delay(0, () => {
      s.type(0, " ...")
      s.type(1, " ,,,")
    })
    s.update(0, s => closeHistory(s.tr))
    s.type(0, "*")
    s.type(1, "*")
    s.undo(0)
    s.conv(doc(p("hello! ..."), p("bye! ,,,*")))
    s.undo(0)
    s.undo(0)
    s.conv(doc(p("hello"), p("bye! ,,,*")))
    s.redo(0)
    s.redo(0)
    s.redo(0)
    s.conv(doc(p("hello! ...*"), p("bye! ,,,*")))
    s.undo(0)
    s.undo(0)
    s.conv(doc(p("hello!"), p("bye! ,,,*")))
    s.undo(1)
    s.conv(doc(p("hello!"), p("bye")))
  })

  it("support undo with clashing events", () => {
    let s = new DummyServer(doc(p("hello")))
    s.update(0, sel(6))
    s.type(0, "A")
    s.delay(0, () => {
      s.type(0, "B", 4)
      s.type(0, "C", 5)
      s.type(0, "D", 1)
      s.update(1, s => s.tr.delete(2, 5))
    })
    s.conv("DhoA")
    s.undo(0)
    s.undo(0)
    s.conv("ho")
    ist(s.states[0].selection.head, 3)
  })

  it("handles conflicting steps", () => {
    let s = new DummyServer(doc(p("abcde")))
    s.delay(0, () => {
      s.update(0, s => s.tr.delete(3, 4))
      s.type(0, "x")
      s.update(1, s => s.tr.delete(2, 5))
    })
    s.undo(0)
    s.undo(0)
    s.conv(doc(p("ae")))
  })

  it("can undo simultaneous typing", () => {
    let s = new DummyServer(doc(p("A"), p("B")))
    s.update(0, sel(2))
    s.update(1, sel(5))
    s.delay(0, () => {
      s.type(0, "1")
      s.type(0, "2")
      s.type(1, "x")
      s.type(1, "y")
    })
    s.conv(doc(p("A12"), p("Bxy")))
    s.undo(0)
    s.conv(doc(p("A"), p("Bxy")))
    s.undo(1)
    s.conv(doc(p("A"), p("B")))
  })
})
