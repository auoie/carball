//! The game's queue to each player: tokio's bounded channel on the network server; on the browser's local host (one
//! thread, no tokio: `src/bin/host.rs`) a single-threaded one with the calls the game makes (`try_send`, `capacity`)

#[cfg(feature = "net")]
pub use tokio::sync::mpsc::{Receiver, Sender, channel};

#[cfg(not(feature = "net"))]
pub use local::{Receiver, Sender, channel};

#[cfg(not(feature = "net"))]
mod local {
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::rc::Rc;

    struct Queue<T> {
        items: VecDeque<T>,
        bound: usize,
        /// The receiver let go: sends fail, as tokio's
        closed: bool,
    }

    pub struct Sender<T>(Rc<RefCell<Queue<T>>>);

    impl<T> Clone for Sender<T> {
        fn clone(&self) -> Self {
            Self(self.0.clone())
        }
    }

    /// A send refused: the queue full or its receiver gone (the item back)
    #[derive(Debug)]
    pub struct TrySendError<T>(pub T);

    impl<T> Sender<T> {
        pub fn try_send(&self, item: T) -> Result<(), TrySendError<T>> {
            let mut q = self.0.borrow_mut();
            if q.closed || q.items.len() >= q.bound {
                return Err(TrySendError(item));
            }
            q.items.push_back(item);
            Ok(())
        }

        /// Room left in the queue
        pub fn capacity(&self) -> usize {
            let q = self.0.borrow();
            q.bound - q.items.len()
        }
    }

    pub struct Receiver<T>(Rc<RefCell<Queue<T>>>);

    impl<T> Receiver<T> {
        pub fn try_recv(&mut self) -> Option<T> {
            self.0.borrow_mut().items.pop_front()
        }

        /// Every sender let go and nothing left to read: the game is done with this player (its stream ends)
        pub fn finished(&self) -> bool {
            Rc::strong_count(&self.0) == 1 && self.0.borrow().items.is_empty()
        }
    }

    impl<T> Drop for Receiver<T> {
        fn drop(&mut self) {
            self.0.borrow_mut().closed = true;
        }
    }

    pub fn channel<T>(bound: usize) -> (Sender<T>, Receiver<T>) {
        let q = Rc::new(RefCell::new(Queue { items: VecDeque::new(), bound, closed: false }));
        (Sender(q.clone()), Receiver(q))
    }
}
