function queue<T>(worker: (task: T) => void, maxWorkers = 1) {
  const tasks: T[] = [];
  let workersWorking = 0;

  function handleTask() {
    return new Promise<void>((resolve, reject) => {
      resolve();
      if (workersWorking > maxWorkers) return;
      const task = tasks.pop();
      if (!task) return;
      workersWorking += 1;
      worker(task);
      workersWorking -= 1;
    });
  }

  return {
    push: (task: T) => {
      tasks.push(task);
      handleTask();
    },
    get length() {
      return 0;
    },
  };
}

export default queue;
