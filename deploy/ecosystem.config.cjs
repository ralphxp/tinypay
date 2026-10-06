// pm2 process definition — keeps the app alive across crashes and reboots.
// Usage: pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'tinypay',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/tinypay',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
    },
  ],
};
