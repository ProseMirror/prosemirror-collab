import {Transform} from "prosemirror-transform"
import {Node} from "prosemirror-model"
import {schema, eq, doc, blockquote, p, li, ul, em} from "prosemirror-test-builder"
import ist from "ist"

import {rebaseSteps} from "prosemirror-collab"

function runRebase(transforms: readonly Transform[], expected: Node) {
  let start = transforms[0].before, full = new Transform(start)
  transforms.forEach(transform => {
    let rebased = new Transform(transform.doc)
    let start = transform.steps.length + full.steps.length
    rebaseSteps(transform.steps.map((s, i) => ({step: s, inverted: s.invert(transform.docs[i]), origin: transform})),
                full.steps, rebased)
    for (let i = start; i < rebased.steps.length; i++) full.step(rebased.steps[i])
  })

  ist(full.doc, expected, eq)

  for (let tag in (start as any).tag) {
    let mapped = full.mapping.mapResult((start as any).tag[tag])

    let exp = (expected as any).tag[tag]
    if (mapped.deleted) {
      if (exp) throw new Error("Tag " + tag + " was unexpectedly deleted")
    } else {
      if (!exp) throw new Error("Tag " + tag + " is not actually deleted")
      ist(mapped.pos, exp)
    }
  }
}

function permute<T>(array: readonly T[]): readonly (readonly T[])[] {
  if (array.length < 2) return [array]
  let result = []
  for (let i = 0; i < array.length; i++) {
    let others = permute(array.slice(0, i).concat(array.slice(i + 1)))
    for (let j = 0; j < others.length; j++)
      result.push([array[i]].concat(others[j]))
  }
  return result
}

function rebase(doc: Node, ...clients: (((tr: Transform) => Transform) | Node)[]) {
  let expected = clients.pop() as Node
  runRebase((clients as ((tr: Transform) => Transform)[]).map(cl => cl(new Transform(doc))), expected)
}

function rebase$(doc: Node, ...clients: (((tr: Transform) => Transform) | Node)[]) {
  let expected = clients.pop() as Node
  permute((clients as ((tr: Transform) => Transform)[]).map(cl => cl(new Transform(doc))))
    .forEach(transforms => runRebase(transforms, expected))
}

function type(tr: Transform, pos: number, text: string) {
  return tr.replaceWith(pos, pos, schema.text(text))
}

function wrap(tr: Transform, pos: number, type: string) {
  let $pos = tr.doc.resolve(pos)
  return tr.wrap($pos.blockRange($pos)!, [{type: schema.nodes[type]}])
}

describe("rebaseSteps", () => {
  it("supports concurrent typing", () => {
    rebase$(doc(p("h<1>ell<2>o")),
            tr => type(tr, 2, "X"),
            tr => type(tr, 5, "Y"),
            doc(p("hX<1>ellY<2>o")))
  })

  it("support multiple concurrently typed chars", () => {
    rebase$(doc(p("h<1>ell<2>o")),
            tr => type(type(type(tr, 2, "X"), 3, "Y"), 4, "Z"),
            tr => type(type(tr, 5, "U"), 6, "V"),
            doc(p("hXYZ<1>ellUV<2>o")))
  })

  it("supports three concurrent typers", () => {
    rebase$(doc(p("h<1>ell<2>o th<3>ere")),
            tr => type(tr, 2, "X"),
            tr => type(tr, 5, "Y"),
            tr => type(tr, 9, "Z"),
            doc(p("hX<1>ellY<2>o thZ<3>ere")))
  })

  it("handles wrapping of changed blocks", () => {
    rebase$(doc(p("<1>hell<2>o<3>")),
            tr => type(tr, 5, "X"),
            tr => wrap(tr, 1, "blockquote"),
            doc(blockquote(p("<1>hellX<2>o<3>"))))
  })

  it("handles insertions in deleted content", () => {
    rebase$(doc(p("hello<1> wo<2>rld<3>!")),
            tr => tr.delete(6, 12),
            tr => type(tr, 9, "X"),
            doc(p("hello<3>!")))
  })

  it("allows deleting the same content twice", () => {
    rebase(doc(p("hello<1> wo<2>rld<3>!")),
           tr => tr.delete(6, 12),
           tr => tr.delete(6, 12),
           doc(p("hello<3>!")))
  })

  it("isn't confused by joining a block that's being edited", () => {
    rebase$(doc(ul(li(p("one")), "<1>", li(p("tw<2>o")))),
            tr => type(tr, 12, "A"),
            tr => tr.join(8),
            doc(ul(li(p("one"), p("twA<2>o")))))
  })

  it("supports typing concurrently with marking", () => {
    rebase(doc(p("hello <1>wo<2>rld<3>")),
           tr => tr.addMark(7, 12, schema.mark("em")),
           tr => type(tr, 9, "_"),
           doc(p("hello <1>", em("wo"), "_<2>", em("rld<3>"))))
  })

  it("doesn't unmark marks added concurrently", () => {
    rebase(doc(p(em("<1>hello"), " world<2>")),
           tr => tr.addMark(1, 12, schema.mark("em")),
           tr => tr.removeMark(1, 12, schema.mark("em")),
           doc(p("<1>hello", em(" world<2>"))))
  })

  it("doesn't mark concurrently unmarked text", () => {
    rebase(doc(p("<1>hello ", em("world<2>"))),
           tr => tr.removeMark(1, 12, schema.mark("em")),
           tr => tr.addMark(1, 12, schema.mark("em")),
           doc(p(em("<1>hello "), "world<2>")))
  })

  it("deletes inserts in replaced context", () => {
    rebase(doc(p("b<before>efore"), blockquote(ul(li(p("o<1>ne")), li(p("t<2>wo")), li(p("thr<3>ee")))), p("a<after>fter")),
           tr => tr.replace((tr.doc as any).tag[1], (tr.doc as any).tag[3],
                            doc(p("a"), blockquote(p("b")), p("c")).slice(2, 9)),
           tr => type(tr, (tr.doc as any).tag[2], "ayay"),
           doc(p("b<before>efore"), blockquote(ul(li(p("o"), blockquote(p("b")), p("<3>ee")))), p("a<after>fter")))
  })

  it("maps through inserts", () => {
    rebase$(doc(p("X<1>X<2>X")),
            tr => type(tr, 2, "hello"),
            tr => type(tr, 3, "goodbye").delete(4, 7),
            doc(p("Xhello<1>Xgbye<2>X")))
  })

  it("handle concurrent removal of blocks", () => {
    rebase(doc(p("a"), "<1>", p("b"), "<2>", p("c")),
           tr => tr.delete((tr.doc as any).tag[1], (tr.doc as any).tag[2]),
           tr => tr.delete((tr.doc as any).tag[1], (tr.doc as any).tag[2]),
           doc(p("a"), "<2>", p("c")))
  })

  it("discards edits in removed blocks", () => {
    rebase$(doc(p("a"), "<1>", p("b<2>"), "<3>", p("c")),
            tr => tr.delete((tr.doc as any).tag[1], (tr.doc as any).tag[3]),
            tr => type(tr, (tr.doc as any).tag[2], "ay"),
            doc(p("a"), "<3>", p("c")))
  })

  it("preserves double block inserts", () => {
    rebase(doc(p("a"), "<1>", p("b")),
           tr => tr.replaceWith(3, 3, schema.node("paragraph")),
           tr => tr.replaceWith(3, 3, schema.node("paragraph")),
           doc(p("a"), p(), p(), "<1>", p("b")))
  })
})
