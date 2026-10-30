import asyncio
import pytest
import threading
import time
from io import BytesIO
from PIL import Image
from app.config import ModelType
from app.models.base import Busy
from app.pb import inference_pb2
from app.scheduler import Scheduler
from app.resource import ResourceManager
from app.service import InferenceService

class Aborted(Exception):
    pass


class MockContext:
    def __init__(self, time_remaining=None, peer="ipv4:127.0.0.1:1"):
        self._done = False
        self._callbacks = []
        self._time_remaining = time_remaining
        self._peer = peer

    def time_remaining(self):
        return self._time_remaining

    def peer(self):
        return self._peer

    async def abort(self, code, details):
        raise Aborted(code)  # gRPC's raises too, ending the call

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

    scheduler = Scheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=3,
        batch_latency=0.1
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

    scheduler = Scheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=10,
        batch_latency=0.1
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
    scheduler = Scheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=1,
        batch_latency=0.01
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

    s1 = Scheduler(rm, process_slow)
    s2 = Scheduler(rm, process_fast)

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

    scheduler = Scheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=10,
        batch_latency=0.2
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
    assert scheduler.metrics.window.abandoned == 2

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_error_propagation():
    rm = ResourceManager()
    await rm.start()

    def process_func_error(items):
        raise ValueError("Simulated Error")

    scheduler = Scheduler(
        resource_manager=rm,
        process_func=process_func_error,
        batch_size=1,
        batch_latency=0.01
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

    scheduler = Scheduler(
        resource_manager=rm,
        process_func=process_func_bad_count,
        batch_size=2,
        batch_latency=0.01
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

    scheduler = Scheduler(
        resource_manager=rm,
        process_func=process_func,
        batch_size=10,
        batch_latency=10.0  # Tasks sit in the queue until stop
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
@pytest.mark.parametrize("batch_size, concurrency", [(2, 1), (1, 2)])  # A batch, or requests side by side
async def test_scheduler_prepare(batch_size, concurrency):
    rm = ResourceManager(concurrency=concurrency)

    def prepare(items):
        return {"items": [f"prepared_{item}" for item in items]}

    def process(prepared):
        return [f"processed_{item}" for item in prepared["items"]]

    scheduler: Scheduler[str, str] = Scheduler(rm, process, prepare_func=prepare, batch_size=batch_size, batch_latency=0.01)
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
async def test_scheduler_concurrency():
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

    scheduler = Scheduler(resource_manager=rm, process_func=process_func)
    await scheduler.start()

    tasks = [asyncio.create_task(scheduler.submit(f"item{i}")) for i in range(5)]

    await asyncio.gather(*tasks)

    assert max_concurrent == CONCURRENCY_LIMIT
    assert scheduler.capacity == CONCURRENCY_LIMIT

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_concurrent_batches():
    rm = ResourceManager(concurrency=2)
    await rm.start()

    started = []
    release = threading.Event()

    def process_func(items):
        started.append(items)
        release.wait()
        return items

    # A long latency window: batches start as soon as they fill, not when it ends
    scheduler = Scheduler(rm, process_func, batch_size=2, batch_latency=10)
    await scheduler.start()

    tasks = [asyncio.create_task(scheduler.submit(i)) for i in range(6)]
    await asyncio.sleep(0.1)
    assert sorted(started) == [[0, 1], [2, 3]]  # As many batches run as the resource allows; the rest wait
    assert scheduler.queued() == 2
    assert scheduler.capacity == 4

    release.set()
    assert await asyncio.wait_for(asyncio.gather(*tasks), 1) == list(range(6))
    assert started[2] == [4, 5]  # The backlog fills the next batch at once

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_item_errors():
    rm = ResourceManager()
    await rm.start()

    def process_func(items):
        return [ValueError(f"bad {i}") if i == "bad" else i for i in items]

    scheduler = Scheduler(rm, process_func, batch_size=3, batch_latency=0.05)
    await scheduler.start()

    results = await asyncio.gather(*(scheduler.submit(i) for i in ("a", "bad", "b")), return_exceptions=True)

    # Only the item that failed fails
    assert results[0] == "a" and results[2] == "b"
    assert isinstance(results[1], ValueError)
    assert (scheduler.metrics.window.requests, scheduler.metrics.window.errors) == (3, 1)
    assert [message for _, message in scheduler.metrics.errors] == ["bad bad"]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_drops_abandoned():
    rm = ResourceManager(concurrency=1)
    await rm.start()

    processed = []
    started = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()

    def process_func(items):
        loop.call_soon_threadsafe(started.set)
        release.wait()
        processed.extend(items)
        return items

    scheduler = Scheduler(resource_manager=rm, process_func=process_func)
    await scheduler.start()

    t1 = asyncio.create_task(scheduler.submit("item1"))
    await started.wait()
    t2 = asyncio.create_task(scheduler.submit("item2"))
    await asyncio.sleep(0.01)
    t2.cancel()  # Its caller leaves while it waits, as on a deadline
    await asyncio.sleep(0.01)
    release.set()

    assert await t1 == "item1"
    assert await scheduler.submit("item3") == "item3"
    assert processed == ["item1", "item3"]
    assert scheduler.queued() == 0
    assert scheduler.metrics.running == 0
    assert scheduler.metrics.window.abandoned == 1

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_cancels_coroutine_run():
    rm = ResourceManager(concurrency=1)
    await rm.start()

    cancelled = asyncio.Event()

    async def process_func(items):  # As a remote model's call
        if items == ["hang"]:
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
        return items

    scheduler = Scheduler(resource_manager=rm, process_func=process_func)
    await scheduler.start()

    with pytest.raises(TimeoutError):
        await asyncio.wait_for(scheduler.submit("hang"), 0.05)  # Its caller leaves, as on a deadline
    await asyncio.wait_for(cancelled.wait(), 1)

    # Its slot is free again, and the run cut short counts as abandoned, not as done or failed
    assert await asyncio.wait_for(scheduler.submit("next"), 1) == "next"
    assert scheduler.metrics.running == 0
    assert scheduler.metrics.window.abandoned == 1
    assert scheduler.metrics.window.errors == 0
    assert scheduler.metrics.window.requests == 1

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_scheduler_cancels_batch_once_its_callers_leave():
    rm = ResourceManager(concurrency=1)
    await rm.start()

    started, cancelled, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def process_func(items):  # As a remote model's call
        if items != ["next"]:
            started.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
        return items

    scheduler = Scheduler(rm, process_func, batch_size=2, batch_latency=0.05)
    await scheduler.start()

    first = asyncio.create_task(scheduler.submit("first"))
    second = asyncio.create_task(scheduler.submit("second"))
    await started.wait()
    first.cancel()  # The run goes on for the caller still there
    await asyncio.sleep(0.01)
    assert not cancelled.is_set()
    second.cancel()  # Then nobody waits for it
    await asyncio.wait_for(cancelled.wait(), 1)

    assert await asyncio.wait_for(scheduler.submit("next"), 1) == "next"
    m = scheduler.metrics
    assert (m.running, m.window.abandoned, m.window.requests, m.window.errors) == (0, 2, 1, 0)

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_service_shares_full_queue_between_callers():
    rm = ResourceManager(concurrency=1)
    await rm.start()

    release = threading.Event()

    def process_func(items):
        release.wait()
        return items

    service = InferenceService([])
    scheduler = service.schedulers[ModelType.TEXT_EMBEDDING] = Scheduler(resource_manager=rm, process_func=process_func)
    await scheduler.start()

    async def call(peer, deadline=60):
        context = MockContext(deadline, peer=peer)
        async with service._admit(context, ModelType.TEXT_EMBEDDING):
            return await scheduler.submit("item", context=context)

    a = [asyncio.create_task(call("a")) for _ in range(2)]
    await asyncio.sleep(0.01)
    assert scheduler.queued() == 1
    with pytest.raises(Aborted, match="RESOURCE_EXHAUSTED"):
        await call("a")

    b = [asyncio.create_task(call("b")) for _ in range(2)]
    await asyncio.sleep(0.01)
    for peer in ("a", "b"):
        with pytest.raises(Aborted, match="RESOURCE_EXHAUSTED"):
            await call(peer)

    c = asyncio.create_task(call("a", deadline=None))
    await asyncio.sleep(0.01)

    release.set()
    assert await asyncio.gather(*a, *b, c) == ["item"] * 5
    assert scheduler.metrics.window.refused == 3
    assert not service.callers[ModelType.TEXT_EMBEDDING]

    await scheduler.stop()
    await rm.stop()

@pytest.mark.asyncio
async def test_service_answers_busy_vlm_as_exhausted():
    rm = ResourceManager()
    await rm.start()

    async def caption(items):  # As agy while its quota is spent
        return [Busy("quota resets later")] * len(items)

    service = InferenceService([])
    service.schedulers[ModelType.CLIP_IMAGE] = Scheduler(rm, lambda images: [[0.0]] * len(images))
    service.schedulers[ModelType.VLM] = Scheduler(rm, caption)
    for scheduler in service.schedulers.values():
        await scheduler.start()

    with BytesIO() as png:
        Image.new('RGB', (4, 4)).save(png, format='PNG')
        request = inference_pb2.AnalyzeImageRequest(image=inference_pb2.Image(data=png.getvalue(), file_format='png'), caption_prompt='Caption it')
    with pytest.raises(Aborted, match="RESOURCE_EXHAUSTED"):
        await service.AnalyzeImage(request, MockContext(60))

    for scheduler in service.schedulers.values():
        await scheduler.stop()
    await rm.stop()
