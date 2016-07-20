const {Transform} = require("../transform")
const RopeSequence = require("rope-sequence")

const {rebaseSteps} = require("./rebase")
exports.rebaseSteps = rebaseSteps

// !! This module implements an API into which a communication channel
// for collaborative editing can be hooked. See [this
// guide](guide/collab.html) for more details and an example.

function randomID() { return Math.floor(Math.random() * 0xFFFFFFFF) }

// ;; This state field accumulates changes that have to be sent to the
// central authority in the collaborating group and makes it possible
// to integrate changes made by peers into our local document. It is
// created and attached to the editor when the
// [plugin](#collabEditing) is enabled, and will be available as the
// `collab` field in the resulting editor state.
class CollabState {
  constructor(version, clientID, unconfirmed) {
    // : number
    // The version number of the last update received from the central
    // authority. Starts at 0 or the value of the `version` property
    // in the option object, for the editor's value when the option
    // was enabled.
    this.version = version

    // : number
    // This client's random ID. Used to identify the origin of
    // changes.
    this.clientID = clientID

    // : RopeSequence<{step: Step, inverted: Step}>
    // The local steps that havent been successfully sent to the
    // server yet.
    this.unconfirmed = unconfirmed
  }

  // :: () → ?{version: number, steps: [Step], clientID: number}
  // Provides the data describing the editor's unconfirmed steps. The
  // version and array of steps are the things you'd send to the
  // central authority. Returns null when there is nothing to send.
  sendableSteps() {
    if (this.unconfirmed.length == 0) return null
    return {
      version: this.version,
      steps: this.unconfirmed.map(s => s.step),
      clientID: this.clientID
    }
  }
}

function unconfirmedFrom(transform, start = 0) {
  let add = []
  for (let i = start; i < transform.steps.length; i++)
    add.push({step: transform.steps[i],
              inverted: transform.steps[i].invert(transform.docs[i])})
  return add
}

// :: (EditorState, [Step], [number]) → EditorState
// Pushes a set of steps (received from the central authority) into
// the editor state (which should have the collab plugin enabled).
// Will recognize its own changes, and confirm unconfirmed steps as
// appropriate. Remaining unconfirmed steps will be rebased over
// remote steps.
function receiveSteps(state, steps, clientIDs) {
  let collab = state.collab
  let version = collab.version + steps.length

  // Find out which prefix of the steps originated with us
  let ours = 0
  while (ours < clientIDs.length && clientIDs[ours] == collab.clientID) ++ours
  let unconfirmed = collab.unconfirmed.slice(ours)
  steps = ours ? steps.slice(ours) : steps

  // If all steps originated with us, we're done.
  if (!steps.length)
    return state.update({collab: new CollabState(version, collab.clientID, unconfirmed)})

  let nUnconfirmed = unconfirmed.length
  let transform = new Transform(state.doc)
  if (nUnconfirmed) {
    rebaseSteps(transform, unconfirmed.map(s => s.step), unconfirmed.map(s => s.inverted), steps)
  } else {
    for (let i = 0; i < steps.length; i++) transform.step(steps[i])
  }

  unconfirmed = RopeSequence.from(unconfirmedFrom(transform, nUnconfirmed + steps.length))
  let newCollabState = new CollabState(version, collab.clientID, unconfirmed)
  return state.applyTransform(transform, {rebased: nUnconfirmed, addToHistory: false, newCollabState})
}

// :: (?Object) → Object
//
// Creates a plugin that enables the collaborative editing framework
// for the editor.
//
// You can pass a `version` option, which determines the starting
// version number of the collaborative editing, and defaults to 0.
exports.collab = function(options) {
  return {
    stateFields: {
      collab: {
        init: () => new CollabState(options && options.version || 0, randomID(), RopeSequence.empty),
        applyTransform({collab}, transform, options) {
          return options.newCollabState ||
            new CollabState(collab.version, collab.clientID, collab.unconfirmed.append(unconfirmedFrom(transform)))
        }
      }
    },

    stateMethods: {
      collabReceive(steps, clientIDs) {
        return receiveSteps(this, steps, clientIDs)
      }
    }
  }
}
