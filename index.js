const {Plugin} = require("../state")
const RopeSequence = require("rope-sequence")

const {rebaseSteps} = require("./rebase")
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

// Pushes a set of steps (received from the central authority) into
// the editor state (which should have the collab plugin enabled).
// Will recognize its own changes, and confirm unconfirmed steps as
// appropriate. Remaining unconfirmed steps will be rebased over
// remote steps.
function makeReceiveAction(state, steps, clientIDs, ourID) {
  let collab = state.collab
  let version = collab.version + steps.length

  // Find out which prefix of the steps originated with us
  let ours = 0
  while (ours < clientIDs.length && clientIDs[ours] == ourID) ++ours
  let unconfirmed = collab.unconfirmed.slice(ours)
  steps = ours ? steps.slice(ours) : steps

  // If all steps originated with us, we're done.
  if (!steps.length)
    return {type: "collabConfirm", collabState: new CollabState(version, unconfirmed)}

  let nUnconfirmed = unconfirmed.length
  let transform = state.tr
  if (nUnconfirmed) {
    rebaseSteps(transform, unconfirmed.map(s => s.step), unconfirmed.map(s => s.inverted), steps)
  } else {
    for (let i = 0; i < steps.length; i++) transform.step(steps[i])
  }

  unconfirmed = RopeSequence.from(unconfirmedFrom(transform, nUnconfirmed + steps.length))
  let newCollabState = new CollabState(version, unconfirmed)
  return transform.action({rebased: nUnconfirmed, addToHistory: false, newCollabState, interaction: false})
}

const plugin = new Plugin({
  stateFields: {
    collab: {
      init: (_, state) => new CollabState(plugin.find(state).config.version, RopeSequence.empty),
      applyAction({collab}, action) {
        if (action.type == "transform")
          return action.newCollabState ||
          new CollabState(collab.version, collab.unconfirmed.append(unconfirmedFrom(action.transform)))
        if (action.type == "collabConfirm")
          return action.collabState
        return collab
      }
    }
  },

  config: {
    version: 0,
    clientID: -1
  }
})

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
//     This client's ID. Defaults to a random 32-bit number.
function collab(config) {
  let clientID = config && config.clientID
  if (clientID == null) clientID =  Math.floor(Math.random() * 0xFFFFFFFF)

  let reconf = {clientID}
  if (config && config.version != null) reconf.version = config.version
  return plugin.configure(reconf)
}
exports.collab = collab

// :: (state: EditorState, steps: [Step], clientIDs: [number]) → Action
// Create an action that represents a set of new steps received from
// the authority. Applying this action moves the state forward along
// with the authority's view of the document.
function receiveAction(state, steps, clientIDs) {
  return makeReceiveAction(state, steps, clientIDs, plugin.find(state).config.clientID)
}
exports.receiveAction = receiveAction

// :: (state: EditorState) → ?{version: number, steps: [Step], clientID: number}
// Provides the data describing the editor's unconfirmed steps. The
// version and array of steps are the things you'd send to the
// central authority. Returns null when there is nothing to send.
function sendableSteps(state) {
  if (state.collab.unconfirmed.length == 0) return null
  return {
    version: state.collab.version,
    steps: state.collab.unconfirmed.map(s => s.step),
    clientID: plugin.find(state).config.clientID
  }
}
exports.sendableSteps = sendableSteps
