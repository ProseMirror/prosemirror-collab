const {Plugin, PluginKey} = require("prosemirror-state")
const RopeSequence = require("rope-sequence")

// : (Transform, [Step], [Step], [Step]) → number
// Undo a given set of steps, apply a set of other steps, and then
// redo them.
function rebaseSteps(transform, steps, inverted, inside) {
  for (let i = inverted.length - 1; i >= 0; i--) transform.step(inverted[i])
  for (let i = 0; i < inside.length; i++) transform.step(inside[i])
  for (let i = 0, mapFrom = inverted.length; i < steps.length; i++) {
    let mapped = steps[i].map(transform.mapping.slice(mapFrom))
    mapFrom--
    if (mapped && !transform.maybeStep(mapped).failed)
      transform.mapping.setMirror(mapFrom, transform.steps.length - 1)
  }
  return inverted.length + inside.length
}
exports.rebaseSteps = rebaseSteps

// This state field accumulates changes that have to be sent to the
// central authority in the collaborating group and makes it possible
// to integrate changes made by peers into our local document. It is
// defined by the plugin, and will be available as the `collab` field
// in the resulting editor state.
class CollabState {
  constructor(version, unconfirmed) {
    // : number
    // The version number of the last update received from the central
    // authority. Starts at 0 or the value of the `version` property
    // in the option object, for the editor's value when the option
    // was enabled.
    this.version = version

    // : RopeSequence<{step: Step, inverted: Step}>
    // The local steps that havent been successfully sent to the
    // server yet.
    this.unconfirmed = unconfirmed
  }
}

function unconfirmedFrom(transform, start = 0) {
  let add = []
  for (let i = start; i < transform.steps.length; i++)
    add.push({step: transform.steps[i],
              inverted: transform.steps[i].invert(transform.docs[i])})
  return add
}

const collabKey = new PluginKey("collab")

// :: (?Object) → Plugin
//
// Creates a plugin that enables the collaborative editing framework
// for the editor.
//
//   config::- An optional set of options
//
//     version:: ?number
//     The starting version number of the collaborative editing.
//     Defaults to 0.
//
//     clientID:: ?number
//     This client's ID, used to distinguish its changes from those of
//     other clients. Defaults to a random 32-bit number.
function collab(config = {}) {
  config = {version: config.version || 0,
            clientID: config.clientID == null ? Math.floor(Math.random() * 0xFFFFFFFF) : config.clientID}

  return new Plugin({
    key: collabKey,

    state: {
      init: () => new CollabState(config.version, RopeSequence.empty),
      apply(tr, collab) {
        let newState = tr.getMeta(collabKey)
        if (newState)
          return newState
        if (tr.docChanged)
          return new CollabState(collab.version, collab.unconfirmed.append(unconfirmedFrom(tr)))
        return collab
      }
    },

    config
  })
}
exports.collab = collab

// :: (state: EditorState, steps: [Step], clientIDs: [number]) → Transaction
// Create a transaction that represents a set of new steps received from
// the authority. Applying this transaction moves the state forward to
// adjust to the authority's view of the document.
function receiveTransaction(state, steps, clientIDs) {
  // Pushes a set of steps (received from the central authority) into
  // the editor state (which should have the collab plugin enabled).
  // Will recognize its own changes, and confirm unconfirmed steps as
  // appropriate. Remaining unconfirmed steps will be rebased over
  // remote steps.
  let collabState = collabKey.getState(state)
  let version = collabState.version + steps.length
  let ourID = collabKey.get(state).options.config.clientID

  // Find out which prefix of the steps originated with us
  let ours = 0
  while (ours < clientIDs.length && clientIDs[ours] == ourID) ++ours
  let unconfirmed = collabState.unconfirmed.slice(ours)
  steps = ours ? steps.slice(ours) : steps

  // If all steps originated with us, we're done.
  if (!steps.length)
    return state.tr.setMeta(collabKey, new CollabState(version, unconfirmed))

  let nUnconfirmed = unconfirmed.length
  let tr = state.tr
  if (nUnconfirmed) {
    rebaseSteps(tr, unconfirmed.map(s => s.step), unconfirmed.map(s => s.inverted), steps)
  } else {
    for (let i = 0; i < steps.length; i++) tr.step(steps[i])
  }

  unconfirmed = RopeSequence.from(unconfirmedFrom(tr, nUnconfirmed + steps.length))
  let newCollabState = new CollabState(version, unconfirmed)
  return tr.setMeta("rebased", nUnconfirmed).setMeta("addToHistory", false).setMeta(collabKey, newCollabState)
}
exports.receiveTransaction = receiveTransaction

// :: (state: EditorState) → ?{version: number, steps: [Step], clientID: number}
// Provides the data describing the editor's unconfirmed steps, which
// you'd send to the central authority. Returns null when there is
// nothing to send.
function sendableSteps(state) {
  let collabState = collabKey.getState(state)
  if (collabState.unconfirmed.length == 0) return null
  return {
    version: collabState.version,
    steps: collabState.unconfirmed.map(s => s.step),
    clientID: collabKey.get(state).options.config.clientID
  }
}
exports.sendableSteps = sendableSteps

// :: (EditorState) → number
// Get the version up to which the collab plugin has synced with the
// central authority.
function getVersion(state) {
  return collabKey.getState(state).version
}
exports.getVersion = getVersion
