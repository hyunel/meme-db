import asyncio
import pytest
import threading
import time
from app.schedulers import Scheduler, BatchScheduler, SimpleScheduler, ResourceManager

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

    t1 = scheduler.submit("item1")

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

    # Batch size 1, so every item is its own batch
    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=1,
        max_latency=0.01
    )
    await scheduler.start()

    t1 = asyncio.create_task(scheduler.submit("low", priority=0))

    await processing_started.wait()

    t2 = asyncio.create_task(scheduler.submit("high", priority=10))
    t3 = asyncio.create_task(scheduler.submit("medium", priority=5))

    continue_event.set()

    await asyncio.gather(t1, t2, t3)

    # "low" was already running; the rest go by priority
    assert processed_batches[0] == ["low"]
    assert processed_batches[1] == ["high"]
    assert processed_batches[2] == ["medium"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_global_priority():
    rm = ResourceManager()
    await rm.start()

    events = []
    loop = asyncio.get_running_loop()
    processing_started = asyncio.Event()
    continue_event = threading.Event()

    def process_slow(items):
        loop.call_soon_threadsafe(processing_started.set)
        continue_event.wait()
        events.append(f"processed_{items[0]}")
        return items

    def process_fast(items):
        events.append(f"processed_{items[0]}")
        return items

    s1 = BatchScheduler(rm, process_slow, 1, 0.01)
    s2 = BatchScheduler(rm, process_fast, 1, 0.01)

    await s1.start()
    await s2.start()

    t1 = asyncio.create_task(s1.submit("s1_low", priority=0))

    await processing_started.wait()

    t2 = asyncio.create_task(s2.submit("s2_high", priority=10))
    t3 = asyncio.create_task(s1.submit("s1_medium", priority=5))

    continue_event.set()

    await asyncio.gather(t1, t2, t3)

    # "s1_low" was already running; the rest go by priority across schedulers
    assert events == ["processed_s1_low", "processed_s2_high", "processed_s1_medium"]

    await s1.stop()
    await s2.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_cancellation_lazy():
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

    t1 = asyncio.create_task(scheduler.submit("item1", context=ctx))
    t2 = asyncio.create_task(scheduler.submit("item2", context=ctx))
    t3 = asyncio.create_task(scheduler.submit("item3")) # No context, won't be cancelled

    await asyncio.sleep(0.01)

    ctx.cancel()

    # Cancelled tasks are dropped when the batch forms
    res3 = await t3
    assert res3 == "item3"

    with pytest.raises(asyncio.CancelledError):
        await t1
    with pytest.raises(asyncio.CancelledError):
        await t2

    assert len(processed_batches) == 1
    assert processed_batches[0] == ["item3"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_error_propagation():
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

    t1 = asyncio.create_task(scheduler.submit("item1"))

    with pytest.raises(ValueError, match="Simulated Error"):
        await t1

    # A second failure, rather than a hang, shows the worker survived
    t2 = asyncio.create_task(scheduler.submit("item2"))
    with pytest.raises(ValueError, match="Simulated Error"):
        await t2

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_result_mismatch():
    rm = ResourceManager()
    await rm.start()

    def process_func_bad_count(items):
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

    # Submitted together so they form one batch
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
    rm = ResourceManager()
    await rm.start()

    def process_func(items):
        return items

    scheduler = BatchScheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=10,
        max_latency=10.0  # Tasks sit in the queue until stop
    )
    await scheduler.start()

    t1 = asyncio.create_task(scheduler.submit("item1"))

    await asyncio.sleep(0.01)

    await scheduler.stop()

    await asyncio.sleep(0.01)

    assert t1.done()
    assert t1.cancelled()
    await rm.stop()

@pytest.mark.asyncio
@pytest.mark.parametrize("scheduler_class, options", [
    (BatchScheduler, {"batch_size": 2, "max_latency": 0.01}),
    (SimpleScheduler, {}),
])
async def test_scheduler_prepare(scheduler_class, options):
    rm = ResourceManager()

    def prepare(items):
        return {"items": [f"prepared_{item}" for item in items]}

    def process(prepared):
        return [f"processed_{item}" for item in prepared["items"]]

    scheduler: Scheduler[str, str] = scheduler_class(rm, process, prepare_func=prepare, **options)
    await rm.start()
    await scheduler.start()
    try:
        results = await asyncio.gather(scheduler.submit("item1"), scheduler.submit("item2"))
        assert results == ["processed_prepared_item1", "processed_prepared_item2"]
        assert scheduler.queued() == 0
        assert scheduler.metrics.window.requests == 2
    finally:
        await scheduler.stop()
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
    )
    await scheduler.start()

    res = await scheduler.submit("item1")
    assert res == "processed_item1"
    assert processed_items == ["item1"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_simple_scheduler_concurrency():
    CONCURRENCY_LIMIT = 2
    rm = ResourceManager(concurrency=CONCURRENCY_LIMIT)
    await rm.start()

    processed_count = 0
    max_concurrent = 0
    lock = threading.Lock()

    def process_func(items):
        nonlocal processed_count, max_concurrent
        with lock:
            processed_count += 1
            max_concurrent = max(max_concurrent, processed_count)

        time.sleep(0.1)

        with lock:
            processed_count -= 1
        return [f"processed_{i}" for i in items]

    scheduler = SimpleScheduler(
        resource_manager=rm,
        process_func=process_func,
    )
    await scheduler.start()

    tasks = [asyncio.create_task(scheduler.submit(f"item{i}")) for i in range(5)]

    await asyncio.gather(*tasks)

    assert max_concurrent == CONCURRENCY_LIMIT

    await scheduler.stop()
    await rm.stop()
