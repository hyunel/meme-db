import asyncio
import pytest
import threading
import time
from app.schedulers import BatchScheduler, SimpleScheduler, ResourceManager

class MockContext:
    def __init__(self):
        self._done = False
        self._callbacks = []

    def cancel(self):
        self._done = True
        for cb in self._callbacks:
            cb(self)

    def done(self):
        return self._done

    def add_done_callback(self, callback):
        self._callbacks.append(callback)

@pytest.mark.asyncio
async def test_scheduler_batching():
    rm = ResourceManager()
    await rm.start()

    processed_batches = []

    def process_func(items):
        processed_batches.append(items)
        return [f"processed_{i}" for i in items]

    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=3,
        max_latency=0.1
    )
    await scheduler.start()

    # Submit 3 items quickly
    t1 = scheduler.submit("item1")
    t2 = scheduler.submit("item2")
    t3 = scheduler.submit("item3")

    results = await asyncio.gather(t1, t2, t3)

    assert results == ["processed_item1", "processed_item2", "processed_item3"]
    assert len(processed_batches) == 1
    assert processed_batches[0] == ["item1", "item2", "item3"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_latency():
    rm = ResourceManager()
    await rm.start()

    processed_batches = []

    def process_func(items):
        processed_batches.append(items)
        return [f"processed_{i}" for i in items]

    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=10,
        max_latency=0.1
    )
    await scheduler.start()

    # Submit 1 item
    t1 = scheduler.submit("item1")

    # Wait for result
    res = await t1
    assert res == "processed_item1"
    assert len(processed_batches) == 1
    assert processed_batches[0] == ["item1"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_priority_local():
    rm = ResourceManager()
    await rm.start()

    processed_batches = []
    processing_started = asyncio.Event()
    continue_event = threading.Event()
    loop = asyncio.get_running_loop()

    def process_func(items):
        loop.call_soon_threadsafe(processing_started.set)
        continue_event.wait()
        processed_batches.append(items)
        return [f"processed_{i}" for i in items]

    # Batch size 1 to force sequential processing by RM
    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=1,
        max_latency=0.01
    )
    await scheduler.start()

    # 1. Submit low priority first.
    t1 = asyncio.create_task(scheduler.submit("low", priority=0))

    # Wait until it starts processing
    await processing_started.wait()

    # 2. Submit high and medium tasks.
    t2 = asyncio.create_task(scheduler.submit("high", priority=10))
    t3 = asyncio.create_task(scheduler.submit("medium", priority=5))

    # Allow the first task to finish
    continue_event.set()

    await asyncio.gather(t1, t2, t3)

    # Order should be low (started), then high (priority), then medium
    assert processed_batches[0] == ["low"]
    assert processed_batches[1] == ["high"]
    assert processed_batches[2] == ["medium"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_global_priority():
    """
    Test that ResourceManager respects priority across different schedulers.
    """
    rm = ResourceManager()
    await rm.start()

    events = []
    loop = asyncio.get_running_loop()
    processing_started = asyncio.Event()
    continue_event = threading.Event()

    def process_slow(items):
        # Notify we started
        loop.call_soon_threadsafe(processing_started.set)
        # Block until we allow it to continue
        continue_event.wait()
        events.append(f"processed_{items[0]}")
        return items

    def process_fast(items):
        events.append(f"processed_{items[0]}")
        return items

    s1 = BatchScheduler(rm, process_slow, 1, 0.01) # Scheduler 1
    s2 = BatchScheduler(rm, process_fast, 1, 0.01) # Scheduler 2

    await s1.start()
    await s2.start()

    # 1. Start a slow task on S1 (Low Priority)
    t1 = asyncio.create_task(s1.submit("s1_low", priority=0))

    # Wait for it to grab the RM worker
    await processing_started.wait()

    # 2. While S1 is running, submit tasks to S1 and S2 with different priorities
    # S2 has High Priority task
    t2 = asyncio.create_task(s2.submit("s2_high", priority=10))
    # S1 has Medium Priority task
    t3 = asyncio.create_task(s1.submit("s1_medium", priority=5))

    # Allow the first task to finish
    continue_event.set()

    await asyncio.gather(t1, t2, t3)

    # Expected: s1_low (started first), then s2_high (highest global priority), then s1_medium
    assert events == ["processed_s1_low", "processed_s2_high", "processed_s1_medium"]

    await s1.stop()
    await s2.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_cancellation_lazy():
    """
    Test that cancelled tasks are removed/ignored before batch processing.
    """
    rm = ResourceManager()
    await rm.start()

    processed_batches = []

    def process_func(items):
        processed_batches.append(items)
        return items

    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=10,
        max_latency=0.2
    )
    await scheduler.start()

    ctx = MockContext()

    # Submit 3 items, enough to fill a batch
    # We must schedule them so they enter the queue
    t1 = asyncio.create_task(scheduler.submit("item1", context=ctx))
    t2 = asyncio.create_task(scheduler.submit("item2", context=ctx))
    t3 = asyncio.create_task(scheduler.submit("item3")) # No context, won't be cancelled

    # Give them a moment to reach the queue (but not be processed yet, latency window open)
    await asyncio.sleep(0.01)

    # Cancel t1 and t2 immediately
    ctx.cancel()

    # Wait for t3.
    # The scheduler should discard t1 and t2 from batch formation.
    res3 = await t3
    assert res3 == "item3"

    # t1 and t2 should be cancelled
    with pytest.raises(asyncio.CancelledError):
        await t1
    with pytest.raises(asyncio.CancelledError):
        await t2

    # The processed batch should ONLY contain item3
    assert len(processed_batches) == 1
    assert processed_batches[0] == ["item3"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_error_propagation():
    """
    Test that exceptions in process_func are propagated to futures.
    """
    rm = ResourceManager()
    await rm.start()

    def process_func_error(items):
        raise ValueError("Simulated Error")

    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func_error,
        batch_size=1,
        max_latency=0.01
    )
    await scheduler.start()

    # Submit a task
    t1 = asyncio.create_task(scheduler.submit("item1"))

    # Verify it raises ValueError
    with pytest.raises(ValueError, match="Simulated Error"):
        await t1

    # Verify scheduler is still alive by submitting another task
    # We need a non-error func to verify, but we can't change func dynamically cleanly.
    # Instead, we check if another task fails with same error (worker didn't crash).
    t2 = asyncio.create_task(scheduler.submit("item2"))
    with pytest.raises(ValueError, match="Simulated Error"):
        await t2

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_result_mismatch():
    """
    Test that result count mismatch raises RuntimeError.
    """
    rm = ResourceManager()
    await rm.start()

    def process_func_bad_count(items):
        # Return fewer results than items
        return [f"processed_{i}" for i in items[:-1]]

    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func_bad_count,
        batch_size=2,
        max_latency=0.01
    )
    await scheduler.start()

    t1 = scheduler.submit("item1")
    t2 = scheduler.submit("item2")

    # Both should fail with RuntimeError
    # We must run them concurrently to form a batch
    results = asyncio.gather(t1, t2, return_exceptions=True)
    res = await results

    assert isinstance(res[0], RuntimeError)
    assert "Batch processing returned" in str(res[0])
    assert isinstance(res[1], RuntimeError)
    assert "Batch processing returned" in str(res[1])

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_shutdown_handling():
    """
    Test that shutdown cancels pending tasks.
    """
    rm = ResourceManager()
    await rm.start()

    def process_func(items):
        return items

    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=10,
        max_latency=10.0 # Long latency, tasks will sit in queue
    )
    await scheduler.start()

    # Submit tasks, they will wait for batch to fill or latency
    t1 = asyncio.create_task(scheduler.submit("item1"))

    # Wait a bit to ensure it's in the queue (or waiting for first task loop)
    await asyncio.sleep(0.01)

    # Stop scheduler
    await scheduler.stop()

    # Allow loop to propagate cancellation to t1
    await asyncio.sleep(0.01)

    # Check if t1 is done (it should be cancelled)
    assert t1.done()
    assert t1.cancelled()
    # No manual cleanup needed
    await rm.stop()

@pytest.mark.asyncio
async def test_simple_scheduler_basic():
    rm = ResourceManager(concurrency=2)
    await rm.start()

    processed_items = []

    def process_func(items):
        processed_items.extend(items)
        return [f"processed_{i}" for i in items]

    scheduler = SimpleScheduler(
        resource_manager=rm,
        process_func=process_func,
        concurrency=1
    )
    await scheduler.start()

    res = await scheduler.submit("item1")
    assert res == "processed_item1"
    assert processed_items == ["item1"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_simple_scheduler_concurrency():
    rm = ResourceManager(concurrency=10)
    await rm.start()

    processed_count = 0
    max_concurrent = 0
    lock = threading.Lock()

    # We use a smaller concurrency for test
    CONCURRENCY_LIMIT = 2

    def process_func(items):
        nonlocal processed_count, max_concurrent
        with lock:
            processed_count += 1
            max_concurrent = max(max_concurrent, processed_count)

        # Simulate work
        time.sleep(0.1)

        with lock:
            processed_count -= 1
        return [f"processed_{i}" for i in items]

    scheduler = SimpleScheduler(
        resource_manager=rm,
        process_func=process_func,
        concurrency=CONCURRENCY_LIMIT
    )
    await scheduler.start()

    # Submit more than concurrency limit
    tasks = [asyncio.create_task(scheduler.submit(f"item{i}")) for i in range(5)]

    await asyncio.gather(*tasks)

    # Verify that max_concurrent never exceeded CONCURRENCY_LIMIT
    assert max_concurrent == CONCURRENCY_LIMIT

    await scheduler.stop()
    await rm.stop()
