module.exports = {
  apps: [
    {
      name: "tmu-server",
      script: "server.js",
      instances: "max",
      exec_mode: "cluster",
      sticky: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
