module.exports = {
  packagerConfig: {
    name: 'Pasalho POS',
    executableName: 'PasalhoPOS',
    asar: true,
    ignore: [/^\/out($|\/)/, /^\/\.git($|\/)/],
  },
  makers: [{ name: '@electron-forge/maker-squirrel', config: { name: 'PasalhoPOS' } }],
};
