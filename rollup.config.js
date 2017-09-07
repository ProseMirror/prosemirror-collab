module.exports = {
  input: "./src/collab.js",
  output: {format: "cjs", file: "dist/collab.js"},
  sourcemap: true,
  plugins: [require("rollup-plugin-buble")()],
  external(id) { return !/^[\.\/]/.test(id) }
}
