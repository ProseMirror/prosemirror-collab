module.exports = {
  entry: "./src/collab.js",
  dest: "dist/collab.js",
  format: "cjs",
  sourceMap: true,
  plugins: [require("rollup-plugin-buble")()],
  external(id) { return !/^[\.\/]/.test(id) }
}
